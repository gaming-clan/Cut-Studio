# Cut Studio

Cut Studio is a Flutter video editor with a local media-processing backend. The backend is required for importing video, preview streaming, AI, caption generation, and exports.

## Requirements

- Flutter (Dart 3.3+)
- Node.js 20+
- FFmpeg and FFprobe available on PATH (`ffmpeg -version` and `ffprobe -version`)
- LM Studio CLI and a local chat model for offline AI planning (default: `google/gemma-4-e4b`); an OpenAI key is optional for cloud vision planning and transcription

Install FFmpeg on Windows with `winget install Gyan.FFmpeg`, on macOS with `brew install ffmpeg`, or on Debian/Ubuntu with `sudo apt install ffmpeg`. The FFmpeg executable must include `libx264`, AAC, `afftdn`, `silencedetect`, and `blackdetect` support.

## Start the backend

```sh
cd backend
npm install
```

Start LM Studio and load a local model, then run the backend. The AI planner uses `lms chat` locally by default, so it does not need a cloud key. For LM Studio frame analysis, create a local API token and set `LM_STUDIO_API_TOKEN`; that route sends sampled frames to the local vision model. The text-only CLI fallback never claims to inspect frames or audio.

PowerShell (optional cloud transcription/vision):

```powershell
$env:OPENAI_API_KEY = "your-key"
npm start
```

macOS/Linux (optional local vision token):

```sh
export LM_STUDIO_API_TOKEN="your-local-token"
npm start
```

The backend listens on `127.0.0.1:8787`, stores uploaded media and exports under `backend/data/`, and restricts browser CORS to localhost origins by default. Configure `ALLOWED_ORIGIN` for a hosted Flutter origin. Set `HOST=0.0.0.0` only when a mobile device must reach the computer over a trusted network; point `AI_API_URL` to the computer's LAN address in that case. Android emulators typically use `10.0.2.2` to reach the host machine. For production, put the service behind authentication, upload limits, per-user storage, and rate limiting.

Optional variables: `PORT`, `HOST`, `FFMPEG_PATH`, `FFPROBE_PATH`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `TRANSCRIPTION_MODEL`, `LM_STUDIO_MODEL`, `LM_STUDIO_CLI`, `LM_STUDIO_BASE_URL`, `LM_STUDIO_API_TOKEN` (or `LM_API_TOKEN`), `CUT_STUDIO_DATA`, and `ALLOWED_ORIGIN`. Without a cloud key, the `/api/edit-plan` route uses the local CLI model. `/api/captions` still needs a configured transcription provider.

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
4. Generate timestamped caption segments with OpenAI transcription (requires `OPENAI_API_KEY`); choose selectable soft subtitles or burn captions into the picture at export. Review transcript text and timing before delivery.
5. Render a timeline sequence as H.264/AAC MP4 at 720p, 1080p, or 4K in 16:9, 9:16, or 1:1. FFmpeg scales and pads to fit, normalizes frame rate, applies exposure/contrast/saturation controls, filters and normalizes source audio, and can mix imported background music with fades and a limiter. Optional silence removal detects long low-volume sections and preserves a short breath around each cut.
6. Run export QC for codec, dimensions, duration, audio presence, extended black intervals, and extended silence. Download the output from the export result dialog.

With `OPENAI_API_KEY`, the AI planner samples two frames from each timeline clip and can transcribe speech when a request asks about dialogue, quotes, captions, or a transcript. Without a cloud key, it calls the installed LM Studio model through `lms chat` and returns a text-only suggestion grounded in filenames and FFprobe metadata. To use a local vision model, set `LM_STUDIO_API_TOKEN`; the backend then sends sampled frames to the LM Studio OpenAI-compatible local API. The text-only mode does not invent trims or pretend to see footage. Review any vision-based cut proposal before applying it.

The editing workflow follows the supplied production guide: inspect source stream properties; preserve originals in the uploads area; organize the timeline; use evidence-based cuts; normalize picture and audio; choose framing and caption format; encode to a delivery profile; then check output metadata and review playback around cuts, captions, sync, picture, and sound. Technical QC cannot judge whether the story or color treatment is editorially right. Uploaded sources remain separate from generated exports.
