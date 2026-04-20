import socketio
import time

# Connect to server
sio = socketio.Client()

@sio.event
def connect():
    print('Connected to server')

@sio.event
def disconnect():
    print('Disconnected from server')

# Placeholder for detection logic
def detect_race_result():
    # TODO: Implement yt-dlp + ffmpeg + detection
    return 1  # Placeholder placement

@sio.on('start-detection')
def on_start_detection(data):
    youtube_url = data['url']
    print(f'Starting detection for {youtube_url}')
    
    # Simulate detection
    time.sleep(10)  # Simulate time
    placement = detect_race_result()
    
    sio.emit('race-complete', {'placement': placement})

if __name__ == '__main__':
    sio.connect('http://localhost:3000')
    sio.wait()