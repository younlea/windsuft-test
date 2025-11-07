#!/usr/bin/env python3
"""FastAPI backend serving the hand simulator."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Dict, List

import pybullet as pb
import pybullet_data
import uvicorn
import yaml
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    import xacro
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "xacro is required. Install with `pip install xacro` or source ROS2."  # noqa: E501
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XACRO = ROOT / "urdf" / "hand.urdf.xacro"
DEFAULT_LIMITS = ROOT / "config" / "joint_limits.yaml"
MOTION_DIR = ROOT / "config" / "motions"
SAMPLE_URDF = ROOT / "urdf" / "sample_hand.urdf"
DEFAULT_MODEL_SOURCE = "sample"

app = FastAPI(title="Hand Simulator Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = ROOT / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


class JointCommand(BaseModel):
    targets: Dict[str, float]
    max_force: float = 5.0


class MotionRequest(BaseModel):
    name: str
    scale: float = 1.0


class MotionKeyframe(BaseModel):
    time: float
    joints: Dict[str, float]


class MotionDefinition(BaseModel):
    name: str
    frequency: float
    keyframes: List[MotionKeyframe]


def render_urdf(source: str = "auto") -> str:
    if source not in {"auto", "sample", "xacro"}:
        raise RuntimeError(f"Unsupported URDF source '{source}'")

    if source == "sample":
        if not SAMPLE_URDF.exists():
            raise RuntimeError("Sample URDF not found")
        return SAMPLE_URDF.read_text(encoding="utf-8")

    if source == "xacro":
        if not DEFAULT_XACRO.exists():
            raise RuntimeError("Xacro source not found")
        return xacro.process_file(DEFAULT_XACRO).toxml()

    # auto mode
    if DEFAULT_XACRO.exists():
        try:
            return xacro.process_file(DEFAULT_XACRO).toxml()
        except Exception:  # pragma: no cover
            if SAMPLE_URDF.exists():
                return SAMPLE_URDF.read_text(encoding="utf-8")
            raise
    if SAMPLE_URDF.exists():
        return SAMPLE_URDF.read_text(encoding="utf-8")
    raise RuntimeError("No URDF source available")


class Simulation:
    def __init__(self, xacro_file: Path, limits_file: Path, urdf_source: str = "auto") -> None:
        self.xacro_file = xacro_file
        self.limits = self._load_limits(limits_file)
        self.urdf_source = urdf_source
        self.physics_client = pb.connect(pb.DIRECT)
        pb.setAdditionalSearchPath(pybullet_data.getDataPath())
        pb.setGravity(0, 0, -9.81)
        pb.loadURDF("plane.urdf")
        self.hand_id = self._load_hand()
        self.joint_map = self._build_joint_map()

    def _load_limits(self, path: Path) -> Dict[str, Dict[str, float]]:
        with path.open("r", encoding="utf-8") as stream:
            data = yaml.safe_load(stream)
        return data.get("limits", {})

    def _load_hand(self) -> int:
        xml = render_urdf(self.urdf_source)
        tmp = tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False)
        tmp.write(xml)
        tmp.close()
        return pb.loadURDF(tmp.name, useFixedBase=True)

    def _build_joint_map(self) -> Dict[str, int]:
        mapping: Dict[str, int] = {}
        for idx in range(pb.getNumJoints(self.hand_id)):
            info = pb.getJointInfo(self.hand_id, idx)
            name = info[1].decode("utf-8")
            if info[2] == pb.JOINT_REVOLUTE:
                mapping[name] = idx
        return mapping

    def get_joint_state(self) -> Dict[str, float]:
        state = {}
        for name, idx in self.joint_map.items():
            pos, vel, _, _ = pb.getJointState(self.hand_id, idx)
            state[name] = pos
        return state

    def apply_targets(self, targets: Dict[str, float], max_force: float) -> None:
        for name, value in targets.items():
            idx = self.joint_map.get(name)
            if idx is None:
                continue
            pb.setJointMotorControl2(
                bodyIndex=self.hand_id,
                jointIndex=idx,
                controlMode=pb.POSITION_CONTROL,
                targetPosition=value,
                force=max_force,
            )

    def step(self, time_step: float = 1.0 / 240.0) -> None:
        pb.stepSimulation()


simulation = Simulation(DEFAULT_XACRO, DEFAULT_LIMITS, urdf_source=DEFAULT_MODEL_SOURCE)
state_subscribers: List[WebSocket] = []
state_publish_task: asyncio.Task | None = None


async def ensure_state_publisher() -> None:
    global state_publish_task
    if state_publish_task and not state_publish_task.done():
        return

    async def publisher() -> None:
        try:
            while True:
                state = simulation.get_joint_state()
                message = {"type": "state", "joints": state}
                for ws in list(state_subscribers):
                    try:
                        await ws.send_json(message)
                    except Exception:
                        state_subscribers.remove(ws)
                simulation.step()
                await asyncio.sleep(1.0 / 20.0)
        except asyncio.CancelledError:  # pragma: no cover
            pass

    state_publish_task = asyncio.create_task(publisher())


@app.get("/")
async def root() -> RedirectResponse:
    return RedirectResponse(url="/app/")


@app.get("/urdf")
async def get_urdf(source: str = Query("auto", pattern="^(auto|sample|xacro)$")) -> Response:
    try:
        xml = render_urdf(source)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(content=xml, media_type="application/xml")


@app.get("/joints")
async def list_joints() -> Dict[str, Dict[str, float]]:
    return simulation.limits


@app.post("/joints/command")
async def command_joints(cmd: JointCommand, background: BackgroundTasks) -> Dict[str, str]:
    simulation.apply_targets(cmd.targets, cmd.max_force)
    background.add_task(simulation.step)
    return {"status": "queued"}


@app.get("/state")
async def get_state() -> Dict[str, float]:
    return simulation.get_joint_state()


def load_motion(name: str) -> MotionDefinition:
    motion_path = MOTION_DIR / f"{name}.yaml"
    if not motion_path.exists():
        raise HTTPException(status_code=404, detail="Motion not found")
    with motion_path.open("r", encoding="utf-8") as stream:
        data = yaml.safe_load(stream)
    return MotionDefinition(**data)


async def play_motion(motion: MotionDefinition, scale: float = 1.0) -> None:
    if not motion.keyframes:
        return
    total_time = motion.keyframes[-1].time * scale
    start = asyncio.get_running_loop().time()
    idx = 0
    while idx < len(motion.keyframes):
        now = asyncio.get_running_loop().time()
        elapsed = now - start
        frame = motion.keyframes[idx]
        target_time = frame.time * scale
        if elapsed >= target_time:
            simulation.apply_targets(frame.joints, max_force=5.0)
            idx += 1
        simulation.step()
        await asyncio.sleep(1.0 / motion.frequency)
    remaining = total_time - (asyncio.get_running_loop().time() - start)
    if remaining > 0:
        await asyncio.sleep(remaining)


@app.get("/motions")
async def list_motions() -> List[str]:
    return [path.stem for path in MOTION_DIR.glob("*.yaml")]


@app.post("/motions/play")
async def trigger_motion(req: MotionRequest) -> Dict[str, str]:
    motion = load_motion(req.name)
    asyncio.create_task(play_motion(motion, req.scale))
    return {"status": "playing"}


@app.websocket("/ws/state")
async def websocket_state(ws: WebSocket) -> None:
    await ws.accept()
    state_subscribers.append(ws)
    await ensure_state_publisher()
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in state_subscribers:
            state_subscribers.remove(ws)


if __name__ == "__main__":  # pragma: no cover
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
