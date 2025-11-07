# 20-DOF Robotic Hand Simulation Architecture

## Goals
- Model a 20 degree-of-freedom anthropomorphic robotic hand in URDF
- Provide a 3D viewer to inspect link articulation and validate kinematics
- Offer interactive joint control (live sliders / CLI) and scripted motion playback for repeatable experiments
- Keep the stack lightweight and ROS2-friendly while remaining usable with pure Python tooling (PyBullet)

## Repository Layout
```
hand_simulator/
├── docs/
│   └── architecture.md            # High-level design (this file)
├── urdf/
│   ├── hand.urdf.xacro            # Parametric URDF description
│   ├── materials.xacro            # Shared visual material definitions
│   └── macros/
│       └── finger.xacro           # Finger/thumb macro blocks
├── meshes/
│   ├── collision/                 # Low-poly collision shells (STL)
│   └── visual/                    # High-res visuals (DAE/OBJ)
├── config/
│   ├── joint_limits.yaml          # Position/velocity/effort ranges
│   ├── ros2_controllers.yaml      # ros2_control configuration
│   └── motions/
│       └── grasp_sequence.yaml    # Example scripted gesture
├── scripts/
│   ├── spawn_in_pybullet.py       # Load URDF & interactive viewer
│   ├── joint_slider_gui.py        # Qt-based joint control panel
│   └── motion_player.py           # Replay motions from YAML
├── launch/
│   ├── display.launch.py          # Launch RViz + joint_state_publisher_gui
│   └── control.launch.py          # Launch ros2_control hardware emulation
└── README.md
```

## URDF Design
### Link & Joint Topology
- `world` → `base_link` (palm)
- **Thumb chain (4 DOF)**
  1. `thumb_cmc` (`revolute`, abduct/adduct about Y)
  2. `thumb_mcp` (`revolute`, flex/extend about Z)
  3. `thumb_ip_prox` (`revolute`, flex/extend about Z)
  4. `thumb_ip_dist` (`revolute`, flex/extend about Z)
- **Index finger chain (4 DOF)**
  1. `index_abd` (`revolute`, abduct/adduct about Y)
  2. `index_mcp` (`revolute`, flex/extend about Z)
  3. `index_pip` (`revolute`, flex/extend about Z)
  4. `index_dip` (`revolute`, flex/extend about Z)
- **Middle finger chain (4 DOF)**
  - Identical pattern: `middle_abd`, `middle_mcp`, `middle_pip`, `middle_dip`
- **Ring finger chain (4 DOF)**
  - Identical pattern: `ring_abd`, `ring_mcp`, `ring_pip`, `ring_dip`
- **Little finger chain (4 DOF)**
  - Identical pattern: `little_abd`, `little_mcp`, `little_pip`, `little_dip`

Total DOF: 5 fingers × 4 DOF = 20.

### Naming & Xacro Macros
- `finger.xacro` will parameterize finger lengths, joint axes, offsets, and naming per finger.
- Use `<xacro:macro>` to generate link/joint pairs with arguments: `prefix`, `base_offset`, `link_lengths`, `abd_axis`. Thumb macro variant handles rotated mounting frame (≈45° about Z) and shorter phalanges.

### Link Geometry
- Default units: meters.
- Suggested nominal lengths (tune per CAD):
  - Proximal phalanx: 0.045 m
  - Middle phalanx: 0.030 m
  - Distal phalanx: 0.025 m (thumb distal 0.02 m)
- `base_link` approximated as a 0.08 m × 0.075 m × 0.02 m box for collision.
- Visual meshes exported from CAD (OBJ/DAE) with origin at joint frame.

### Joint Limits (initial values)
| Joint | Min (rad) | Max (rad) | Velocity (rad/s) | Notes |
|-------|-----------|-----------|------------------|-------|
| *_abd | -0.35     | 0.35      | 2.0              | Lateral spread |
| thumb_cmc | -0.79 | 0.79      | 2.0              | Wider thumb range |
| *_mcp | 0.0       | 1.6       | 3.0              | Flexion |
| *_pip | 0.0       | 1.8       | 3.0              | Flexion |
| *_dip | 0.0       | 2.0       | 3.0              | Flexion |
| thumb_ip_* | 0.0  | 1.9       | 3.0              | Flexion |

Populate `config/joint_limits.yaml` and reuse for both ROS2 and PyBullet control.

### Inertial Parameters
- Estimate link masses proportional to lengths (e.g., proximal 20 g, middle 15 g, distal 10 g, thumb distal 8 g).
- Compute inertia tensors assuming uniform density rods (use cylindrical approximation).
- Document assumptions for future calibration.

### Transmission & Control
- Use `ros2_control` `<transmission>` blocks for each joint.
- `ros2_control` joint interface: position command with effort/velocity limits enforced.
- For PyBullet scripts, map joint indices by name and clamp commands using shared limit config.

## Visualization & Control Interfaces

### ROS2 + RViz Pipeline
1. Launch `display.launch.py`:
   - Runs `robot_state_publisher` with `hand.urdf.xacro`.
   - Starts `joint_state_publisher_gui` for manual sliders.
   - Opens RViz scene with TF, RobotModel, and joint trajectory display.
2. For recorded motions, run `motion_player.py --ros` to publish `trajectory_msgs/JointTrajectory` on `/hand_controller/joint_trajectory`.
3. Optional: integrate `MoveIt 2` later for grasp planning.

### PyBullet Standalone Viewer
- `spawn_in_pybullet.py` loads URDF, spawns GUI window, and exposes REST-like control interface via ZeroMQ or direct CLI.
- `joint_slider_gui.py` (PyQt5) communicates via ROS2 topic or PyBullet API to adjust joint targets interactively.
- Physics configuration: gravity -9.81 m/s², fixed base.

### Web App Control Stack
- **Backend (FastAPI + PyBullet DIRECT)**
  - Runs the physics simulation headlessly using PyBullet DIRECT mode.
  - Generates URDF on demand from Xacro and exposes it at `/urdf`.
  - Provides REST endpoints for querying joints (`/joints`), sending position commands (`/joints/command`), listing motions (`/motions`), and triggering playback (`/motions/play`).
  - Streams live joint states via WebSocket `/ws/state` at ~20 Hz for front-end visualization.
  - Falls back to `urdf/sample_hand.urdf` (primitive 20-DOF model) whenever the parametric Xacro is missing or invalid; you can force sources with `/urdf?source=sample|xacro`.
- **Frontend (React/Vite or vanilla JS + Three.js)**
  - Loads the URDF into a WebGL scene using `three.js` + `URDFLoader` for real-time visualization.
  - Builds joint sliders dynamically from `/joints` metadata, dispatching REST updates with debounce.
  - Displays prerecorded motions in a dropdown and triggers playback through the REST API.
  - Shows state feedback (joint angle text overlays) using WebSocket stream.

The backend can be containerized and deployed behind a reverse proxy; the front-end is a static build served either by FastAPI or a CDN.

### Motion Authoring
- YAML format per motion:
  ```yaml
  name: pinch_grasp
  frequency: 50        # Hz keyframe playback
  keyframes:
    - time: 0.0
      joints: {index_mcp: 0.0, index_pip: 0.0, thumb_cmc: 0.2, ...}
    - time: 1.0
      joints: {index_mcp: 0.9, index_pip: 1.2, thumb_cmc: 0.5, ...}
  ```
- `motion_player.py` interpolates between keyframes and publishes trajectories (ROS2) or sets PyBullet joint positions each timestep.

## Next Implementation Steps
1. Build `hand.urdf.xacro` using macros; verify with `check_urdf`.
2. Create placeholder meshes (simple cylinders/boxes) until CAD assets are ready.
3. Implement ROS2 launch files and confirm RViz visualization.
4. Write PyBullet script for standalone visualization.
5. Develop GUI sliders and scripted motion tools.
6. Add unit tests for kinematic chain consistency (e.g., `urdf_parser_py`).
7. Integrate sample URDF in testing/deployment until CAD-derived model is ready.
