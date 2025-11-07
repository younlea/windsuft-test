# Hand Simulator

20-DOF anthropomorphic robotic hand simulation stack featuring parametric URDF assets, a FastAPI + PyBullet backend, and a Three.js web viewer for interactive control.

## Features
- **20 DOF modeling**: Thumb + four fingers, each with abduction, MCP, PIP, DIP joints.
- **Xacro & Sample URDF**: Parametric `hand.urdf.xacro` plus a primitive `sample_hand.urdf` for quick visualization.
- **Physics backends**: PyBullet scripts for rapid iteration and ROS2-friendly layout.
- **Web control surface**: FastAPI backend with REST/WebSocket APIs and a Three.js front-end.
- **Motion playback**: YAML keyframe motions playable through backend or scripts.

## Repository Layout
```
hand_simulator/
├── backend/
│   ├── __init__.py
│   └── main.py               # FastAPI app (URDF serving, joint control, motions)
├── config/
│   ├── joint_limits.yaml     # Joint boundaries reused across tools
│   └── motions/
│       └── pinch_grasp.yaml  # Example keyframe motion
├── docs/
│   └── architecture.md       # Detailed design doc
├── frontend/
│   ├── index.html            # Web UI root
│   ├── main.js               # Three.js viewer + control logic
│   └── styles.css            # UI styling
├── scripts/
│   └── spawn_in_pybullet.py  # Desktop PyBullet viewer with sliders
├── urdf/
│   ├── hand.urdf.xacro       # Parametric URDF
│   ├── materials.xacro       # Shared material definitions
│   ├── macros/
│   │   └── finger.xacro      # Finger/thumb macro library
│   └── sample_hand.urdf      # Primitive 20-DOF sample model
└── README.md
```

## Getting Started

### Prerequisites
- Python 3.9+
- Node.js (optional, if you plan to bundle/extend the frontend)

Recommended Python packages:
```bash
pip install fastapi uvicorn pybullet pyyaml xacro
```
Frontend dependencies are loaded via ES modules/CDN in `frontend/index.html`, so no build step is required unless you want to customize the stack.

#### Ubuntu Quickstart (tested on 22.04+)
```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip build-essential
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install fastapi uvicorn pybullet pyyaml xacro

# launch backend (bind to all interfaces for remote access)
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```
- 기본적으로 샘플 20-DOF URDF가 로드됩니다. Xacro 모델이 준비되면 `/urdf?source=xacro`로 전환하세요.
- 다른 기기에서 접속하려면 `http://<ubuntu-ip>:8000/app/` URL을 사용하고 방화벽에서 `8000/tcp`를 허용하세요 (`sudo ufw allow 8000/tcp`).

### Running the Web App
1. **Launch backend**
   ```bash
   uvicorn backend.main:app --reload
   ```
2. **Open browser** at [http://localhost:8000/app/](http://localhost:8000/app/)
   - Joint sliders appear automatically using metadata from `config/joint_limits.yaml`.
   - The viewer loads the URDF via `/urdf` (sample model by default).
   - Use the motion dropdown to play `pinch_grasp` and observe state updates in real time.

> ❗️ The backend auto-selects a URDF source. If `hand.urdf.xacro` fails or is missing, it falls back to `sample_hand.urdf`. Force a specific source:
> - Sample: `GET /urdf?source=sample`
> - Xacro: `GET /urdf?source=xacro`

### Desktop PyBullet Viewer
For local experimentation without the web UI:
```bash
python scripts/spawn_in_pybullet.py
```
This opens the PyBullet GUI, loads the URDF, and builds sliders for each revolute joint.

### Motion Files
Motions live under `config/motions/` in YAML keyframe format:
```yaml
name: pinch_grasp
frequency: 50.0
keyframes:
  - time: 0.0
    joints:
      thumb_cmc: 0.1
      index_mcp: 0.0
  - time: 0.8
    joints:
      thumb_cmc: 0.45
      index_mcp: 1.0
```
You can add additional motions and trigger them via `POST /motions/play` with `{ "name": "your_motion" }`.

## Development Notes
- See `docs/architecture.md` for detailed link/joint topology, macros, and future work checklist.@docs/architecture.md#1-145
- Joint limits in `config/joint_limits.yaml` supply both the backend and frontend UI.@config/joint_limits.yaml#1-64
- URDF macros in `urdf/macros/finger.xacro` allow parametric finger definitions; use `xacro` CLI for validation.@urdf/macros/finger.xacro#1-157

## Future Enhancements
1. Hook into ROS2 `ros2_control` for hardware abstraction.
2. Replace placeholder geometry with CAD-derived meshes/inertias.
3. Add authentication for remote backend deployments.
4. Integrate motion authoring UI or MoveIt-based planners.
