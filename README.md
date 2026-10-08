# Cut Studio

Cut Studio is a Flutter video editor with a local media-processing backend. The backend is required for importing video, preview streaming, AI, caption generation, and exports.

## Requirements

- Flutter (Dart 3.3+)
- Node.js 20+
- FFmpeg and FFprobe available on PATH (`ffmpeg -version` and `ffprobe -version`)
- An OpenAI API key for AI planning and automatic captions

Install FFmpeg on Windows with `winget install Gyan.FFmpeg`, on macOS with `brew install ffmpeg`, or on Debian/Ubuntu with `sudo apt install ffmpeg`. The FFmpeg executable must include `libx264`, AAC, `afftdn`, `silencedetect`, and `blackdetect` support.

## Start the backend

```sh
cd backend
npm install
```

PowerShell:

```powershell
$env:OPENAI_API_KEY = "your-key"
npm start
```

macOS/Linux:

```sh
export OPENAI_API_KEY="your-key"
npm start
```

The backend listens on `127.0.0.1:8787`, stores uploaded media and exports under `backend/data/`, and restricts browser CORS to localhost origins by default. Configure `ALLOWED_ORIGIN` for a hosted Flutter origin. Set `HOST=0.0.0.0` only when a mobile device must reach the computer over a trusted network; point `AI_API_URL` to the computer's LAN address in that case. Android emulators typically use `10.0.2.2` to reach the host machine. For production, put the service behind authentication, upload limits, per-user storage, and rate limiting.

Optional variables: `PORT`, `HOST`, `FFMPEG_PATH`, `FFPROBE_PATH`, `OPENAI_MODEL`, `TRANSCRIPTION_MODEL`, `CUT_STUDIO_DATA`, and `ALLOWED_ORIGIN`.

## Start Flutter

In another terminal from the project root:

```sh
flutter create --platforms web,android,ios,windows .
flutter pub get
flutter run -d chrome
```

Use a generated Windows runner for native Windows preview. The project includes the Windows `video_player` implementation. Configure a reachable backend endpoint when needed:

```sh
flutter run --dart-define=AI_API_URL=http://localhost:8787/api/edit-plan
```

Do not place OpenAI keys in Flutter source or a mobile app bundle.

## Implemented media workflow

1. Import videos into the local backend; FFprobe reads duration, dimensions, frame rate, codecs, and audio presence.
2. Preview a selected clip with playback controls and switch clips from the timeline.
3. Set a non-destructive in/out trim range per media clip and reorder or remove timeline clips.
4. Generate captions with OpenAI transcription (requires `OPENAI_API_KEY`); reviewable caption segments are embedded in the exported MP4.
5. Render a timeline sequence as H.264/AAC MP4 at 720p, 1080p, or 4K. FFmpeg applies scale/pad, frame-rate normalization, exposure/contrast/saturation controls, audio filtering/noise reduction and loudness normalization. Optional silence removal detects long low-volume sections and preserves a short breath around each cut.
6. Run export QC for codec, dimensions, duration, audio presence, extended black intervals, and extended silence. Download the output from the export result dialog.

The AI edit planner still returns a reviewable plan based on the prompt and clip metadata; it does not watch the video or silently change the timeline. Review all suggested silence cuts and quality warnings before delivery. The guide file referenced in chat was not available to the implementation environment, so its specific procedures and checklist have not yet been incorporated.
