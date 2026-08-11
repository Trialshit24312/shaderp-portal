# KOVERT CV worker
#
# 1) pip install -r requirements.txt
# 2) set AC_API_KEY to match portal
# 3) uvicorn main:app --host 0.0.0.0 --port 8091
# 4) On Render portal env: CV_WORKER_URL=https://your-cv-worker.onrender.com
#
# Optional YOLO_WEIGHTS=/models/menu.pt for trained detector.
# Without YOLO, OpenCV heuristics flag multi-panel / dense-center overlays only.
# All hits are staff-review only (Vision Overlay detection) — never auto-ban.
