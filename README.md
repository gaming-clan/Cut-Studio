# Cut Studio

Cut Studio is a Flutter video editor prototype with a responsive desktop and mobile editing workspace.

## Run the Flutter app

Install Flutter, generate the platform runners, then run:

```sh
flutter create --platforms web,android,ios .
flutter pub get
flutter run -d chrome
```

Use `flutter run` with an attached Android or iOS device for the mobile layout.

## Run the AI edit planner

The app calls a small Node backend so the OpenAI key never ships in the Flutter client. Node.js 20 or newer is required.

```sh
cd backend
# PowerShell: $env:OPENAI_API_KEY="your-key"
# macOS/Linux: export OPENAI_API_KEY="your-key"
npm start
```

In another terminal, start Flutter. The default AI endpoint is `http://localhost:8787/api/edit-plan`:

```sh
flutter run -d chrome
```

Override it for a hosted backend or a device that cannot reach the computer's localhost:

```sh
flutter run --dart-define=AI_API_URL=https://your-backend.example.com/api/edit-plan
```

The backend reads `OPENAI_API_KEY` and optional `OPENAI_MODEL` from its environment. The default model is `gpt-4.1-mini`. Set `ALLOWED_ORIGIN` to your app origin when deploying. Do not put API keys in Flutter source, `--dart-define`, or a mobile app bundle. A deployed service also needs authentication, rate limits, and abuse controls before public use.

The planner receives the user's prompt, clip filenames and sizes, and caption toggle. It cannot inspect media content and returns a structured, reviewable plan. The current editor does not yet apply plan steps to footage or render an export.

## Current scope

Import video files into the media bin and timeline, select clips, move them left or right, remove them, adjust clip controls, and request an AI edit plan. Quick actions for silence removal, audio cleanup, and color matching now request a plan from the backend. Captions and export remain interface prototypes. Video playback, clip trimming, persistent projects, generated captions, audio processing, and rendered video export still need a media engine.
