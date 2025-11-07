#!/usr/bin/env python3
"""Launch the 20-DOF hand model in PyBullet with live joint sliders."""
from __future__ import annotations

import argparse
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, Iterable, Tuple

import pybullet as pb
import pybullet_data
import yaml

try:
    import xacro
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "xacro is required. Install with `pip install xacro` or source ROS2."  # noqa: E501
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XACRO = ROOT / "urdf" / "hand.urdf.xacro"
DEFAULT_LIMITS = ROOT / "config" / "joint_limits.yaml"


def generate_urdf(xacro_file: Path) -> str:
    document = xacro.process_file(xacro_file)
    return document.toprettyxml(indent="  ")


def load_joint_limits(path: Path) -> Dict[str, Dict[str, float]]:
    with path.open("r", encoding="utf-8") as stream:
        data = yaml.safe_load(stream)
    if not data or "limits" not in data:
        raise ValueError(f"No joint limits found in {path}")
    return data["limits"]


def create_sliders(
    body: int,
    joint_limits: Dict[str, Dict[str, float]],
) -> Dict[int, Tuple[int, str]]:
    slider_to_joint: Dict[int, Tuple[int, str]] = {}
    for joint_index in range(pb.getNumJoints(body)):
        info = pb.getJointInfo(body, joint_index)
        name = info[1].decode("utf-8")
        if info[2] != pb.JOINT_REVOLUTE:
            continue
        limits = joint_limits.get(name, {})
        lower = limits.get("lower", -3.14)
        upper = limits.get("upper", 3.14)
        default = limits.get("default", 0.0)
        slider_id = pb.addUserDebugParameter(name, lower, upper, default)
        slider_to_joint[slider_id] = (joint_index, name)
    return slider_to_joint


def set_initial_positions(body: int, joint_limits: Dict[str, Dict[str, float]]) -> None:
    for joint_index in range(pb.getNumJoints(body)):
        info = pb.getJointInfo(body, joint_index)
        if info[2] != pb.JOINT_REVOLUTE:
            continue
        name = info[1].decode("utf-8")
        default = joint_limits.get(name, {}).get("default", 0.0)
        pb.resetJointState(body, joint_index, default)
        pb.setJointMotorControl2(
            bodyIndex=body,
            jointIndex=joint_index,
            controlMode=pb.POSITION_CONTROL,
            targetPosition=default,
            force=pb.getUserDebugParameterForce()
            if hasattr(pb, "getUserDebugParameterForce")
            else 5.0,
        )


def playback_loop(
    body: int,
    slider_mapping: Dict[int, Tuple[int, str]],
    time_step: float,
    max_force: float,
) -> None:
    try:
        while True:
            for slider_id, (joint_index, _) in slider_mapping.items():
                target = pb.readUserDebugParameter(slider_id)
                pb.setJointMotorControl2(
                    bodyIndex=body,
                    jointIndex=joint_index,
                    controlMode=pb.POSITION_CONTROL,
                    targetPosition=target,
                    force=max_force,
                )
            pb.stepSimulation()
            time.sleep(time_step)
    except KeyboardInterrupt:
        print("\nExiting...", file=sys.stderr)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--xacro",
        type=Path,
        default=DEFAULT_XACRO,
        help="Path to the hand.xacro file",
    )
    parser.add_argument(
        "--joint-limits",
        type=Path,
        default=DEFAULT_LIMITS,
        help="YAML file with joint limit definitions",
    )
    parser.add_argument(
        "--time-step",
        type=float,
        default=1.0 / 240.0,
        help="Simulation time step in seconds",
    )
    parser.add_argument(
        "--max-force",
        type=float,
        default=5.0,
        help="Max motor force per joint",
    )
    parser.add_argument(
        "--no-plane",
        action="store_true",
        help="Do not spawn the PyBullet ground plane",
    )
    parser.add_argument(
        "--gravity",
        type=float,
        default=-9.81,
        help="Gravity along Z axis (m/s^2)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()

    if not args.xacro.exists():
        raise SystemExit(f"Missing Xacro file: {args.xacro}")
    if not args.joint_limits.exists():
        raise SystemExit(f"Missing joint limit config: {args.joint_limits}")

    pb.connect(pb.GUI)
    pb.configureDebugVisualizer(pb.COV_ENABLE_GUI, 1)
    pb.setGravity(0, 0, args.gravity)
    pb.setTimeStep(args.time_step)
    pb.setAdditionalSearchPath(pybullet_data.getDataPath())

    if not args.no_plane:
        pb.loadURDF("plane.urdf")

    urdf_text = generate_urdf(args.xacro)
    with tempfile.NamedTemporaryFile("w", suffix=".urdf", delete=False) as tmp:
        tmp.write(urdf_text)
        urdf_path = tmp.name

    hand = pb.loadURDF(urdf_path, useFixedBase=True)

    joint_limits = load_joint_limits(args.joint_limits)
    set_initial_positions(hand, joint_limits)
    slider_mapping = create_sliders(hand, joint_limits)

    print(
        "Loaded hand with joints:\n  "
        + "\n  ".join(name for _, name in slider_mapping.values())
    )
    print("Use the on-screen sliders to explore the hand pose. Press Ctrl+C to exit.")

    playback_loop(hand, slider_mapping, args.time_step, args.max_force)

    pb.disconnect()


if __name__ == "__main__":  # pragma: no cover
    main()
