require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const SpotifyWebApi = require('spotify-web-api-node');

// Spotify API configuration
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

let spotifyAccessToken = null;

// Function to refresh Spotify access token
async function refreshSpotifyToken() {
    try {
        console.log('Attempting to refresh Spotify token...');
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyAccessToken = data.body['access_token'];
        spotifyApi.setAccessToken(spotifyAccessToken);
        console.log('Successfully refreshed Spotify token');
        // Token expires in 1 hour, refresh after 50 minutes
        setTimeout(refreshSpotifyToken, 50 * 60 * 1000);
    } catch (error) {
        console.error('Error refreshing Spotify token:', error);
        // Retry after 1 minute if failed
        setTimeout(refreshSpotifyToken, 60 * 1000);
    }
}

// Initial token refresh
refreshSpotifyToken();

// Function to generate a random 5-character room ID
function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 5; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Function to extract playlist ID from Spotify URL
function extractPlaylistId(url) {
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
}

// Store active rooms
const rooms = new Map();

app.use(express.static('public'));
app.use(express.json());

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/views/index.html');
});

// Add new endpoint to handle Spotify playlist
app.get('/api/spotify/playlist/:playlistId', async (req, res) => {
    try {
        const playlistId = req.params.playlistId;
        
        // Get client credentials
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        
        // Get playlist tracks
        const playlist = await spotifyApi.getPlaylist(playlistId);
        res.json(playlist.body);
    } catch (error) {
        console.error('Error fetching playlist:', error);
        res.status(500).json({ error: 'Failed to fetch playlist' });
    }
});

// Add endpoint to get Spotify access token
app.get('/api/spotify/token', async (req, res) => {
    console.log('Token request received');
    try {
        if (!spotifyAccessToken) {
            await refreshSpotifyToken();
        }
        if (spotifyAccessToken) {
            console.log('Sending Spotify token');
            res.json({ accessToken: spotifyAccessToken });
        } else {
            console.error('No Spotify token available after refresh');
            res.status(500).json({ error: 'Spotify token not available' });
        }
    } catch (error) {
        console.error('Error getting Spotify token:', error);
        res.status(500).json({ error: 'Failed to get Spotify token' });
    }
});

// Handle socket connections
io.on('connection', (socket) => {
    console.log('a user connected');

    socket.on('createRoom', () => {
        const roomId = generateRoomId();
        rooms.set(roomId, {
            host: socket.id,
            users: new Set([socket.id]),
            currentSong: null,
            currentSongIndex: -1,
            playlist: [],
            isPlaying: false,
            currentTime: 0,
            lastUpdateTime: Date.now()
        });
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('userCountUpdate', 1);
    });

    socket.on('joinRoom', (roomId) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.users.add(socket.id);
            socket.join(roomId);
            
            // Calculate current time based on last update and play state
            const timeSinceLastUpdate = (Date.now() - room.lastUpdateTime) / 1000;
            const currentTime = room.isPlaying ? 
                room.currentTime + timeSinceLastUpdate : 
                room.currentTime;

            // If there's a current song, ensure the host is ready before sending to new user
            if (room.currentSong) {
                // Wait a short moment to ensure the host's player is ready
                setTimeout(() => {
                    socket.emit('roomJoined', {
                        roomId,
                        currentSong: room.currentSong,
                        isPlaying: room.isPlaying,
                        currentTime: currentTime,
                        videoId: room.currentSong.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/)?.[1]
                    });
                }, 1000);
            } else {
                socket.emit('roomJoined', {
                    roomId,
                    currentSong: null,
                    isPlaying: false,
                    currentTime: 0
                });
            }
            
            io.to(roomId).emit('userJoined', socket.id);
            io.to(roomId).emit('userCountUpdate', room.users.size);
        }
    });

    socket.on('leaveRoom', (roomId) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.users.delete(socket.id);
            socket.leave(roomId);
            io.to(roomId).emit('userLeft', socket.id);
            io.to(roomId).emit('userCountUpdate', room.users.size);
            
            if (room.users.size === 0) {
                rooms.delete(roomId);
            }
        }
    });

    socket.on('play', (roomId) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.isPlaying = true;
            room.lastUpdateTime = Date.now();
            io.to(roomId).emit('play');
        }
    });

    socket.on('pause', (roomId) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.isPlaying = false;
            room.lastUpdateTime = Date.now();
            io.to(roomId).emit('pause');
        }
    });

    socket.on('timeUpdate', (data) => {
        const { roomId, currentTime } = data;
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.currentTime = currentTime;
            room.lastUpdateTime = Date.now();
        }
    });

    socket.on('seek', (data) => {
        const { roomId, time } = data;
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.currentTime = time;
            room.lastUpdateTime = Date.now();
            io.to(roomId).emit('seek', time);
        }
    });

    socket.on('skip', (roomId) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            if (room.playlist.length > 0) {
                const nextIndex = (room.currentSongIndex + 1) % room.playlist.length;
                const nextSong = room.playlist[nextIndex];
                
                room.currentSongIndex = nextIndex;
                room.currentSong = nextSong;
                room.currentTime = 0;
                room.lastUpdateTime = Date.now();
                room.isPlaying = true;
                
                io.to(roomId).emit('skip', {
                    currentSong: nextSong,
                    currentTime: 0,
                    isPlaying: true
                });
            } else if (room.currentSong) {
                // If there's no playlist but there is a current song (e.g., YouTube playlist),
                // just emit skip to synchronize all users
                io.to(roomId).emit('skip', {
                    currentSong: room.currentSong,
                    currentTime: 0,
                    isPlaying: true
                });
            }
        }
    });

    socket.on('previous', (roomId) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            if (room.playlist.length > 0) {
                // Calculate previous index, wrapping around if needed
                const prevIndex = (room.currentSongIndex - 1 + room.playlist.length) % room.playlist.length;
                const prevSong = room.playlist[prevIndex];
                
                room.currentSongIndex = prevIndex;
                room.currentSong = prevSong;
                room.currentTime = 0;
                room.lastUpdateTime = Date.now();
                room.isPlaying = true;
                
                io.to(roomId).emit('previous', {
                    currentSong: prevSong,
                    currentTime: 0,
                    isPlaying: true
                });
            } else if (room.currentSong) {
                // If there's no playlist but there is a current song (e.g., YouTube playlist),
                // just emit previous to synchronize all users
                io.to(roomId).emit('previous', {
                    currentSong: room.currentSong,
                    currentTime: 0,
                    isPlaying: true
                });
            }
        }
    });

    socket.on('addSong', (data) => {
        const { roomId, url } = data;
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.playlist.push(url);
            if (room.currentSong === null) {
                room.currentSong = url;
                room.currentSongIndex = 0;
                room.currentTime = 0;
                room.lastUpdateTime = Date.now();
                io.to(roomId).emit('newSong', url);
            }
        }
    });

    socket.on('addSpotifyTrack', async (data) => {
        const { roomId, trackId } = data;
        if (rooms.has(roomId)) {
            try {
                if (!spotifyAccessToken) {
                    await refreshSpotifyToken();
                }
                
                const track = await spotifyApi.getTrack(trackId);
                if (!track || !track.body) {
                    throw new Error('Invalid track response');
                }

                const trackInfo = {
                    name: track.body.name,
                    artist: track.body.artists[0].name,
                    uri: track.body.uri,
                    duration_ms: track.body.duration_ms,
                    preview_url: track.body.preview_url
                };
                
                // Get the room's Spotify device ID
                const room = rooms.get(roomId);
                if (!room.spotifyDeviceId) {
                    throw new Error('No Spotify device available in room');
                }
                
                io.to(roomId).emit('spotifyTrackLoaded', trackInfo);
            } catch (error) {
                console.error('Error loading Spotify track:', error);
                socket.emit('error', 'Failed to load Spotify track');
            }
        }
    });

    socket.on('addSpotifyPlaylist', async (data) => {
        const { roomId, playlistId } = data;
        if (rooms.has(roomId)) {
            try {
                if (!spotifyAccessToken) {
                    await refreshSpotifyToken();
                }
                
                const playlist = await spotifyApi.getPlaylist(playlistId);
                if (!playlist || !playlist.body || !playlist.body.tracks || !playlist.body.tracks.items) {
                    throw new Error('Invalid playlist response');
                }

                const tracks = playlist.body.tracks.items
                    .filter(item => item.track) // Filter out any null tracks
                    .map(item => ({
                        name: item.track.name,
                        artist: item.track.artists[0].name,
                        uri: item.track.uri,
                        duration_ms: item.track.duration_ms,
                        preview_url: item.track.preview_url
                    }));
                
                if (tracks.length === 0) {
                    throw new Error('No tracks found in playlist');
                }
                
                io.to(roomId).emit('spotifyPlaylistLoaded', tracks);
            } catch (error) {
                console.error('Error loading Spotify playlist:', error);
                socket.emit('error', 'Failed to load Spotify playlist');
            }
        }
    });

    socket.on('spotifyDeviceReady', (data) => {
        const { roomId, deviceId } = data;
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.spotifyDeviceId = deviceId;
            console.log(`Spotify device ${deviceId} ready for room ${roomId}`);
        }
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
        // Clean up rooms when users disconnect
        for (const [roomId, room] of rooms.entries()) {
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);
                io.to(roomId).emit('userLeft', socket.id);
                io.to(roomId).emit('userCountUpdate', room.users.size);
                
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3002;
http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 