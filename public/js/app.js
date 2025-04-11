const socket = io();
let player;
let currentRoomId = null;
let isHost = false;
let lastTimeUpdate = 0;
let spotifyPlayer = null;
let spotifyDeviceId = null;

// DOM Elements
const homeScreen = document.getElementById('home-screen');
const roomScreen = document.getElementById('room-screen');
const createRoomBtn = document.getElementById('create-room');
const joinRoomBtn = document.getElementById('join-room');
const roomIdInput = document.getElementById('room-id');
const currentRoomIdSpan = document.getElementById('current-room-id');
const userCountSpan = document.getElementById('user-count');
const leaveRoomBtn = document.getElementById('leave-room');
const playPauseBtn = document.getElementById('play-pause');
const skipBtn = document.getElementById('skip');
const previousBtn = document.getElementById('previous');
const addSongBtn = document.getElementById('add-song');
const songUrlInput = document.getElementById('song-url');
const previewContainer = document.getElementById('preview-container');
const previewImage = document.getElementById('preview-image');
const previewTitle = document.getElementById('preview-title');
const previewSource = document.getElementById('preview-source');

// Event Listeners
createRoomBtn.addEventListener('click', () => {
    socket.emit('createRoom');
});

joinRoomBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (roomId) {
        socket.emit('joinRoom', roomId);
    }
});

leaveRoomBtn.addEventListener('click', () => {
    if (currentRoomId) {
        socket.emit('leaveRoom', currentRoomId);
        currentRoomId = null;
        homeScreen.style.display = 'block';
        roomScreen.style.display = 'none';
        if (player) {
            player.destroy();
            player = null;
        }
        hidePreview();
    }
});

playPauseBtn.addEventListener('click', () => {
    if (currentRoomId && player) {
        if (player.getPlayerState() === YT.PlayerState.PLAYING) {
            player.pauseVideo();
            socket.emit('pause', currentRoomId);
        } else {
            player.playVideo();
            socket.emit('play', currentRoomId);
        }
    }
});

skipBtn.addEventListener('click', () => {
    if (currentRoomId) {
        socket.emit('skip', currentRoomId);
    }
});

previousBtn.addEventListener('click', () => {
    if (currentRoomId) {
        socket.emit('previous', currentRoomId);
    }
});

songUrlInput.addEventListener('input', async () => {
    const url = songUrlInput.value.trim();
    if (url) {
        await updatePreview(url);
    } else {
        hidePreview();
    }
});

addSongBtn.addEventListener('click', () => {
    const url = songUrlInput.value.trim();
    if (url && currentRoomId) {
        socket.emit('addSong', { roomId: currentRoomId, url });
        songUrlInput.value = '';
        hidePreview();
    }
});

// Socket Events
socket.on('roomCreated', (roomId) => {
    currentRoomId = roomId;
    isHost = true;
    currentRoomIdSpan.textContent = roomId;
    homeScreen.style.display = 'none';
    roomScreen.style.display = 'block';
});

function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    const videoId = (match && match[2].length === 11) ? match[2] : null;
    
    // Extract playlist ID if present
    const playlistMatch = url.match(/[&?]list=([^&]+)/);
    const playlistId = playlistMatch ? playlistMatch[1] : null;
    
    return { videoId, playlistId };
}

function initializePlayer(videoData, currentTime, isPlaying) {
    if (player) {
        player.destroy();
    }
    
    const playerDiv = document.getElementById('player');
    playerDiv.style.display = 'block';
    
    const playerVars = {
        'autoplay': 0,
        'controls': 1,
        'modestbranding': 1,
        'enablejsapi': 1,
        'origin': window.location.origin,
        'playsinline': 1
    };

    // If we have a playlist ID, add it to playerVars
    if (videoData.playlistId) {
        playerVars.list = videoData.playlistId;
        playerVars.listType = 'playlist';
    }

    player = new YT.Player('player', {
        height: '360',
        width: '640',
        videoId: videoData.videoId,
        playerVars: playerVars,
        events: {
            'onReady': (event) => {
                event.target.seekTo(currentTime);
                if (isPlaying) {
                    event.target.playVideo();
                }
            },
            'onStateChange': (event) => {
                if (event.data === YT.PlayerState.PLAYING) {
                    playerDiv.style.backgroundColor = 'transparent';
                } else if (event.data === YT.PlayerState.ENDED) {
                    if (!videoData.playlistId) {
                        socket.emit('skip', currentRoomId);
                    }
                }
            },
            'onError': (event) => {
                console.error('YouTube player error:', event.data);
                setTimeout(() => initializePlayer(videoData, currentTime, isPlaying), 2000);
            }
        }
    });

    // Add event listener for seeking
    player.addEventListener('onStateChange', (event) => {
        if (event.data === YT.PlayerState.PLAYING) {
            const currentTime = player.getCurrentTime();
            socket.emit('seek', {
                roomId: currentRoomId,
                time: currentTime
            });
        }
    });
}

socket.on('roomJoined', async (data) => {
    currentRoomId = data.roomId;
    isHost = false;
    currentRoomIdSpan.textContent = data.roomId;
    homeScreen.style.display = 'none';
    roomScreen.style.display = 'block';

    if (data.currentSong && data.videoId) {
        await updatePreview(data.currentSong);
        initializePlayer(data, data.currentTime, data.isPlaying);
    }
});

socket.on('userCountUpdate', (count) => {
    userCountSpan.textContent = count;
});

socket.on('play', () => {
    if (player) {
        player.playVideo();
    }
});

socket.on('pause', () => {
    if (player) {
        player.pauseVideo();
    }
});

socket.on('newSong', async (url) => {
    const videoData = extractVideoId(url);
    if (videoData.videoId || videoData.playlistId) {
        await updatePreview(url);
        if (player) {
            player.destroy();
        }
        initializePlayer(videoData, 0, true);
    }
});

// Helper Functions
function isSpotifyUrl(url) {
    return url.includes('open.spotify.com/');
}

function getSpotifyUrlType(url) {
    if (url.includes('open.spotify.com/track/')) {
        return 'track';
    } else if (url.includes('open.spotify.com/playlist/')) {
        return 'playlist';
    }
    return null;
}

function extractSpotifyId(url) {
    const match = url.match(/\/(track|playlist)\/([a-zA-Z0-9]+)/);
    return match ? match[2] : null;
}

async function updatePreview(url) {
    if (isSpotifyUrl(url)) {
        const type = getSpotifyUrlType(url);
        const id = extractSpotifyId(url);
        
        if (!id) {
            console.error('Invalid Spotify URL');
            return;
        }

        // Hide YouTube player for Spotify
        document.getElementById('player').style.display = 'none';
        
        if (type === 'track') {
            socket.emit('addSpotifyTrack', { roomId: currentRoomId, trackUrl: url, trackId: id });
            // Show loading state
            previewImage.style.backgroundImage = `url('/images/spotify-placeholder.png')`;
            previewTitle.textContent = 'Loading Spotify track...';
            previewSource.textContent = 'Spotify';
            previewContainer.style.display = 'block';
        } else if (type === 'playlist') {
            socket.emit('addSpotifyPlaylist', { roomId: currentRoomId, playlistUrl: url, playlistId: id });
            // Show loading state
            previewImage.style.backgroundImage = `url('/images/spotify-placeholder.png')`;
            previewTitle.textContent = 'Loading Spotify playlist...';
            previewSource.textContent = 'Spotify';
            previewContainer.style.display = 'block';
        }
        return;
    }

    const videoId = extractVideoId(url);
    if (videoId.videoId || videoId.playlistId) {
        // Create YouTube video without autoplay
        if (player) {
            player.destroy();
        }
        // Make sure player container is visible and properly sized
        const playerDiv = document.getElementById('player');
        playerDiv.style.display = 'block';
        
        player = new YT.Player('player', {
            height: '360',
            width: '640',
            videoId: videoId.videoId,
            playerVars: {
                'autoplay': 0,
                'controls': 1,
                'rel': 0,
                'modestbranding': 1,
                'enablejsapi': 1,
                'origin': window.location.origin
            },
            events: {
                'onReady': (event) => {
                    // Don't autoplay on ready
                },
                'onStateChange': (event) => {
                    if (event.data === YT.PlayerState.PLAYING) {
                        playerDiv.style.backgroundColor = 'transparent';
                    }
                },
                'onError': (event) => {
                    console.error('YouTube player error:', event.data);
                }
            }
        });
        previewContainer.style.display = 'none';
    } else if (url.includes('spotify.com')) {
        // Hide YouTube player for Spotify
        document.getElementById('player').style.display = 'none';
        // Spotify preview
        previewImage.style.backgroundImage = `url('/images/spotify-placeholder.png')`;
        previewTitle.textContent = 'Spotify Track';
        previewSource.textContent = 'Spotify';
        previewContainer.style.display = 'block';
    } else {
        hidePreview();
        document.getElementById('player').style.display = 'none';
    }
}

function hidePreview() {
    previewContainer.style.display = 'none';
    previewImage.style.backgroundImage = '';
    previewTitle.textContent = '';
    previewSource.textContent = '';
}

// YouTube API
function onYouTubeIframeAPIReady() {
    console.log('YouTube API Ready');
}

// Periodically update server with current time
setInterval(() => {
    if (player && currentRoomId) {
        const currentTime = player.getCurrentTime();
        if (Math.abs(currentTime - lastTimeUpdate) >= 1) {
            socket.emit('timeUpdate', {
                roomId: currentRoomId,
                currentTime: currentTime
            });
            lastTimeUpdate = currentTime;
        }
    }
}, 1000);

// Add seek event listener
socket.on('seek', (time) => {
    if (player) {
        player.seekTo(time, true);
        if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
            player.playVideo();
        }
    }
});

// Update the spotifyTrackLoaded handler
socket.on('spotifyTrackLoaded', async (trackInfo) => {
    console.log('Spotify track loaded:', trackInfo);
    
    if (!spotifyPlayer || !spotifyDeviceId) {
        console.error('Spotify player or device ID not available');
        previewTitle.textContent = 'Error: Spotify player not ready';
        return;
    }

    try {
        // First, ensure we're connected
        if (!spotifyPlayer._options.getOAuthToken) {
            await spotifyPlayer.connect();
        }

        // Transfer playback to our device
        await fetch('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${spotifyPlayer._options.getOAuthToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                device_ids: [spotifyDeviceId],
                play: true
            })
        });

        // Play the track
        await spotifyPlayer.play({
            uris: [trackInfo.uri],
            device_id: spotifyDeviceId
        });

        // Update UI
        document.getElementById('player').style.display = 'none';
        previewContainer.style.display = 'block';
        previewImage.style.backgroundImage = `url('/images/spotify-placeholder.png')`;
        previewTitle.textContent = `${trackInfo.name} - ${trackInfo.artist}`;
        previewSource.textContent = 'Spotify';
    } catch (error) {
        console.error('Error playing Spotify track:', error);
        previewTitle.textContent = 'Error playing Spotify track';
    }
});

// Update the spotifyPlaylistLoaded handler
socket.on('spotifyPlaylistLoaded', (tracks) => {
    console.log('Spotify playlist loaded:', tracks);
    
    if (!tracks || tracks.length === 0) {
        console.error('No tracks in playlist');
        previewTitle.textContent = 'Error: No tracks in playlist';
        return;
    }

    const playlistContainer = document.createElement('div');
    playlistContainer.className = 'spotify-playlist';
    
    tracks.forEach((track, index) => {
        const trackElement = document.createElement('div');
        trackElement.className = 'spotify-track';
        trackElement.innerHTML = `
            <div class="track-info">
                <span class="track-name">${track.name}</span>
                <span class="track-artist">${track.artist}</span>
            </div>
            ${track.preview_url ? `
                <div class="preview-player">
                    <audio controls>
                        <source src="${track.preview_url}" type="audio/mpeg">
                        Your browser does not support the audio element.
                    </audio>
                </div>
            ` : '<div class="no-preview">No preview available</div>'}
        `;
        
        // Add click handler to play the full track
        trackElement.addEventListener('click', async () => {
            if (spotifyPlayer && spotifyDeviceId) {
                try {
                    await spotifyPlayer.play({
                        uris: [track.uri],
                        device_id: spotifyDeviceId
                    });
                } catch (error) {
                    console.error('Error playing track:', error);
                }
            }
        });
        
        playlistContainer.appendChild(trackElement);
    });

    const playerDiv = document.getElementById('player');
    playerDiv.innerHTML = ''; // Clear any existing content
    playerDiv.appendChild(playlistContainer);
    playerDiv.style.display = 'block';
    previewContainer.style.display = 'none';
});

socket.on('error', (message) => {
    alert(message);
});

// Initialize Spotify Web Playback SDK
window.onSpotifyWebPlaybackSDKReady = async () => {
    console.log('Spotify Web Playback SDK Ready');
    try {
        const response = await fetch('/api/spotify/token');
        if (!response.ok) {
            throw new Error('Failed to get Spotify token');
        }
        const data = await response.json();
        console.log('Received Spotify token:', data);
        
        if (!data.accessToken) {
            throw new Error('No Spotify access token available');
        }

        // Create a new player instance
        spotifyPlayer = new Spotify.Player({
            name: 'ListenAlong Player',
            getOAuthToken: cb => { cb(data.accessToken); },
            volume: 0.5
        });

        // Error handling
        spotifyPlayer.addListener('initialization_error', ({ message }) => {
            console.error('Failed to initialize Spotify player:', message);
            // Attempt to reconnect after a delay
            setTimeout(() => {
                if (spotifyPlayer) {
                    spotifyPlayer.connect();
                }
            }, 5000);
        });

        spotifyPlayer.addListener('authentication_error', ({ message }) => {
            console.error('Failed to authenticate with Spotify:', message);
            // Refresh token and reconnect
            fetch('/api/spotify/token')
                .then(response => response.json())
                .then(data => {
                    if (data.accessToken && spotifyPlayer) {
                        spotifyPlayer.connect();
                    }
                })
                .catch(error => console.error('Error refreshing token:', error));
        });

        spotifyPlayer.addListener('account_error', ({ message }) => {
            console.error('Failed to validate Spotify account:', message);
        });

        // Playback status updates
        spotifyPlayer.addListener('player_state_changed', state => {
            console.log('Player state changed:', state);
            if (currentRoomId && state) {
                socket.emit('timeUpdate', {
                    roomId: currentRoomId,
                    currentTime: state.position / 1000
                });
            }
        });

        // Ready
        spotifyPlayer.addListener('ready', ({ device_id }) => {
            console.log('Spotify player ready with Device ID:', device_id);
            spotifyDeviceId = device_id;
            // Notify server about the device ID
            if (currentRoomId) {
                socket.emit('spotifyDeviceReady', { roomId: currentRoomId, deviceId: device_id });
            }
        });

        // Not Ready
        spotifyPlayer.addListener('not_ready', ({ device_id }) => {
            console.log('Device ID has gone offline', device_id);
            spotifyDeviceId = null;
        });

        // Connect to the player
        console.log('Connecting to Spotify player...');
        const connected = await spotifyPlayer.connect();
        if (!connected) {
            throw new Error('Failed to connect to Spotify player');
        }

        // Wait for the player to be ready
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for Spotify player to be ready'));
            }, 10000);

            spotifyPlayer.addListener('ready', ({ device_id }) => {
                clearTimeout(timeout);
                resolve(device_id);
            });
        });

    } catch (error) {
        console.error('Error initializing Spotify player:', error);
        // Attempt to reconnect after a delay
        setTimeout(() => {
            if (window.onSpotifyWebPlaybackSDKReady) {
                window.onSpotifyWebPlaybackSDKReady();
            }
        }, 5000);
    }
};

// Update the skip event handler to handle playlist skips
socket.on('skip', (data) => {
    if (player) {
        const currentVideoData = player.getVideoData();
        if (currentVideoData && currentVideoData.list) {
            player.nextVideo();
        } else if (data.currentSong) {
            player.destroy();
            const videoData = extractVideoId(data.currentSong);
            if (videoData.videoId || videoData.playlistId) {
                initializePlayer(videoData, 0, true);
            }
        }
    } else if (spotifyPlayer && spotifyDeviceId && data.currentSong && data.currentSong.includes('spotify.com')) {
        spotifyPlayer.nextTrack();
    }
});

socket.on('previous', (data) => {
    if (player) {
        const currentVideoData = player.getVideoData();
        if (currentVideoData && currentVideoData.list) {
            player.previousVideo();
        } else if (data.currentSong) {
            player.destroy();
            const videoData = extractVideoId(data.currentSong);
            if (videoData.videoId || videoData.playlistId) {
                initializePlayer(videoData, 0, true);
            }
        }
    } else if (spotifyPlayer && spotifyDeviceId && data.currentSong && data.currentSong.includes('spotify.com')) {
        spotifyPlayer.previousTrack();
    }
}); 