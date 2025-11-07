import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { URDFLoader } from "urdf-loader";

const backendBase = window.location.origin.replace(/\/$/, "");
const apiBase = backendBase;
const wsUrl = backendBase.replace(/^http/, "ws") + "/ws/state";

const canvasElement = document.getElementById("viewer");
const logContainerElement = document.getElementById("status-log");
const jointControlsElement = document.getElementById("joint-controls");
const motionSelectElement = document.getElementById("motion-select");
const playMotionBtnElement = document.getElementById("play-motion");
const reloadButtonElement = document.getElementById("reload-urdf");
const resetButtonElement = document.getElementById("reset-pose");
const backendLabelElement = document.getElementById("backend-url");
const wsStatusElement = document.getElementById("ws-status");

if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error("Viewer canvas not found");
}
if (!(logContainerElement instanceof HTMLElement)) {
  throw new Error("Status log container missing");
}
if (!(jointControlsElement instanceof HTMLElement)) {
  throw new Error("Joint controls container missing");
}
if (!(motionSelectElement instanceof HTMLSelectElement)) {
  throw new Error("Motion select element missing");
}
if (!(playMotionBtnElement instanceof HTMLButtonElement)) {
  throw new Error("Play motion button missing");
}
if (!(reloadButtonElement instanceof HTMLButtonElement)) {
  throw new Error("Reload button missing");
}
if (!(resetButtonElement instanceof HTMLButtonElement)) {
  throw new Error("Reset button missing");
}
if (!(backendLabelElement instanceof HTMLElement)) {
  throw new Error("Backend label missing");
}
if (!(wsStatusElement instanceof HTMLElement)) {
  throw new Error("WebSocket status label missing");
}

const canvas = canvasElement;
const logContainer = logContainerElement;
const jointControls = jointControlsElement;
const motionSelect = motionSelectElement;
const playMotionBtn = playMotionBtnElement;
const reloadButton = reloadButtonElement;
const resetButton = resetButtonElement;
const backendLabel = backendLabelElement;
const wsStatus = wsStatusElement;

backendLabel.textContent = apiBase;

let scene;
let renderer;
let camera;
let controls;
let currentRobot = null;
let jointLimits = {};
let jointInputs = {};
let ws = null;

function appendLog(message) {
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
  logContainer.appendChild(line);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101010);

  camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.01, 10);
  camera.position.set(0.2, 0.3, 0.4);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.1, 0);
  controls.update();

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  scene.add(light);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1, 1, 1);
  scene.add(dirLight);

  const grid = new THREE.GridHelper(0.5, 20, 0x444444, 0x222222);
  scene.add(grid);

  window.addEventListener("resize", onWindowResize);
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function onWindowResize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

async function fetchJSON(path, options) {
  const res = await fetch(`${apiBase}${path}`, options);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

async function postJSON(path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST failed: ${res.status}`);
  }
}

async function loadURDF() {
  appendLog("Loading URDF...");
  const loader = new URDFLoader();
  loader.fetchOptions = { mode: "cors" };
  loader.packages = {};

  const xml = await fetch(`${apiBase}/urdf`).then((r) => r.text());

  if (currentRobot) {
    scene.remove(currentRobot);
  }

  currentRobot = loader.parse(xml, { packages: loader.packages });
  currentRobot.traverse((child) => {
    if (child.material) {
      child.material.side = THREE.DoubleSide;
    }
  });
  scene.add(currentRobot);
  appendLog("URDF loaded");
}

function createJointControls() {
  jointControls.innerHTML = "";
  jointInputs = {};
  Object.entries(jointLimits).forEach(([name, limits]) => {
    const wrapper = document.createElement("div");
    wrapper.className = "joint-slider";

    const label = document.createElement("label");
    label.textContent = name;
    wrapper.appendChild(label);

    const slider = document.createElement("input");
    slider.type = "range";
    const lower = limits.lower ?? -3.14;
    const upper = limits.upper ?? 3.14;
    slider.min = String(lower);
    slider.max = String(upper);
    slider.step = "0.01";
    slider.value = "0";

    slider.addEventListener("input", () => {
      sendJointCommand(name, parseFloat(slider.value));
    });

    wrapper.appendChild(slider);
    jointControls.appendChild(wrapper);
    jointInputs[name] = slider;
  });
}

async function sendJointCommand(name, value) {
  await postJSON("/joints/command", {
    targets: { [name]: value },
    max_force: 5.0,
  });
}

async function loadJointLimits() {
  jointLimits = await fetchJSON("/joints");
  createJointControls();
  appendLog("Joint metadata loaded");
}

async function loadMotions() {
  const motions = await fetchJSON("/motions");
  motionSelect.innerHTML = '<option value="">-- Select motion --</option>';
  motions.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    motionSelect.appendChild(option);
  });
  appendLog("Motions loaded");
}

async function playSelectedMotion() {
  const name = motionSelect.value;
  if (!name) {
    appendLog("No motion selected");
    return;
  }
  await postJSON("/motions/play", { name });
  appendLog(`Playing motion: ${name}`);
}

function connectWebSocket() {
  if (ws) {
    ws.close();
  }
  ws = new WebSocket(wsUrl);
  wsStatus.textContent = "connecting";

  ws.addEventListener("open", () => {
    wsStatus.textContent = "connected";
    appendLog("WebSocket connected");
  });

  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "state") {
      const joints = data.joints;
      Object.entries(joints).forEach(([name, value]) => {
        const input = jointInputs[name];
        if (input && document.activeElement !== input) {
          input.value = value.toFixed(3);
        }
        if (currentRobot && currentRobot.joints && currentRobot.joints[name]) {
          currentRobot.joints[name].setJointValue(value);
        }
      });
    }
  });

  ws.addEventListener("close", () => {
    wsStatus.textContent = "disconnected";
    appendLog("WebSocket disconnected, retrying...");
    setTimeout(connectWebSocket, 2000);
  });

  ws.addEventListener("error", () => {
    wsStatus.textContent = "error";
  });
}

async function resetPose() {
  const body = {};
  Object.keys(jointInputs).forEach((name) => {
    body[name] = 0;
  });
  await postJSON("/joints/command", { targets: body, max_force: 5.0 });
  appendLog("Pose reset to zero");
}

async function bootstrap() {
  initThree();
  await loadURDF();
  await loadJointLimits();
  await loadMotions();
  connectWebSocket();
}

playMotionBtn.addEventListener("click", () => {
  playSelectedMotion().catch((err) => appendLog(err.message));
});

reloadButton.addEventListener("click", () => {
  loadURDF().catch((err) => appendLog(err.message));
});

resetButton.addEventListener("click", () => {
  resetPose().catch((err) => appendLog(err.message));
});

bootstrap().catch((err) => appendLog(err.message));
