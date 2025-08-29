# Run and deploy

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
4. Open your browser to: http://localhost:5173

## Run in Background

Locally just Run:
   `nohup npm run dev > vite-dev.log 2>&1 & echo $! > .vite-dev.pid && echo "Started PID $(cat .vite-dev.pid). View logs: tail -f vite-dev.log ; stop: kill $(cat .vite-dev.pid)"`
