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
    MAX_RETRIES = 10
    RETRY_DELAY = 3  # seconds between attempts

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f'Connecting to server (attempt {attempt}/{MAX_RETRIES})...')
            sio.connect('http://localhost:3000')
            break
        except Exception as e:
            print(f'Connection failed: {e}')
            if attempt < MAX_RETRIES:
                print(f'Retrying in {RETRY_DELAY} seconds...')
                time.sleep(RETRY_DELAY)
            else:
                print('Could not connect to server after all retries. Exiting.')
                exit(1)

    sio.wait()
