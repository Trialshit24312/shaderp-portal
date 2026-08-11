"""
KOVERT AC — lightweight CV worker (OpenCV heuristics + optional YOLO).

Staff-review only: never auto-bans. Portal queues jobs via CV_WORKER_URL.

Run:
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8091

Env:
  AC_API_KEY / CV_API_KEY — shared with portal
  YOLO_WEIGHTS — optional path to .pt; if missing, uses contour/UI heuristics only
"""
from __future__ import annotations

import base64
import os
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="kovert-cv-worker", version="0.1.0")

API_KEY = os.environ.get("CV_API_KEY") or os.environ.get("AC_API_KEY") or ""


class AnalyzeBody(BaseModel):
    jobId: str | None = None
    sessionId: str | None = None
    playerId: int | str | None = None
    image: str


def _require_key(x_ac_key: str | None) -> None:
    if not API_KEY:
        return
    if not x_ac_key or x_ac_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid AC key")


def _decode_image(image_b64: str) -> np.ndarray:
    raw = image_b64
    if "," in raw and raw.strip().startswith("data:"):
        raw = raw.split(",", 1)[1]
    data = base64.b64decode(raw)
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image")
    return img


def _heuristic_overlays(img: np.ndarray) -> tuple[list[str], float]:
    """Detect large rectangular translucent overlays atypical of vanilla HUD."""
    labels: list[str] = []
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 60, 160)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    big_boxes = 0
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        area = bw * bh
        if area < (w * h) * 0.04:
            continue
        aspect = bw / max(bh, 1)
        if 0.6 <= aspect <= 2.8 and bh > h * 0.18 and bw > w * 0.18:
            big_boxes += 1
    score = 0.0
    if big_boxes >= 2:
        labels.append("multi_panel_overlay")
        score = 0.55
    if big_boxes >= 3:
        labels.append("imgui_like_layout")
        score = 0.72
    # High edge density in center (menus) vs edges (HUD)
    cy0, cy1 = int(h * 0.2), int(h * 0.8)
    cx0, cx1 = int(w * 0.2), int(w * 0.8)
    center = edges[cy0:cy1, cx0:cx1]
    dens = float(np.count_nonzero(center)) / float(center.size or 1)
    if dens > 0.12:
        labels.append("dense_center_ui")
        score = max(score, min(0.9, dens * 4))
    return labels, score


def _yolo_labels(img: np.ndarray) -> tuple[list[str], float]:
    weights = os.environ.get("YOLO_WEIGHTS", "").strip()
    if not weights or not os.path.isfile(weights):
        return [], 0.0
    try:
        from ultralytics import YOLO  # type: ignore

        model = YOLO(weights)
        results = model.predict(img, verbose=False, conf=0.82)
        labels: list[str] = []
        best = 0.0
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                name = r.names.get(cls_id, f"cls_{cls_id}")
                labels.append(f"yolo:{name}:{conf:.2f}")
                best = max(best, conf)
        return labels, best
    except Exception as exc:  # noqa: BLE001
        return [f"yolo_error:{exc}"], 0.0


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "kovert-cv-worker", "yolo": bool(os.environ.get("YOLO_WEIGHTS"))}


@app.post("/analyze")
def analyze(body: AnalyzeBody, x_ac_key: str | None = Header(default=None)) -> dict[str, Any]:
    _require_key(x_ac_key)
    img = _decode_image(body.image)
    h_labels, h_score = _heuristic_overlays(img)
    y_labels, y_score = _yolo_labels(img)
    labels = h_labels + y_labels
    cheat_score = max(h_score, y_score)
    return {
        "ok": True,
        "jobId": body.jobId,
        "sessionId": body.sessionId,
        "playerId": body.playerId,
        "labels": labels,
        "cheatScore": round(cheat_score, 3),
        "note": "staff-review only — never auto-ban",
    }
