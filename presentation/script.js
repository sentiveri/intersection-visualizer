const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1120);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(8, 6, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;

scene.add(new THREE.AmbientLight(0xffffff, 0.65));

const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight1.position.set(10, 15, 12);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.4);
dirLight2.position.set(-10, -10, -10);
scene.add(dirLight2);

const gridHelper = new THREE.GridHelper(16, 16, 0x334155, 0x1e293b);
gridHelper.position.y = -4.5;
scene.add(gridHelper);

const state = {
  r1: 2.0,
  r2: 1.5,
  offsetX: 0.0,
  mode: 'solid',
  autoRotate: false,
  pulse: false,
  showPoint: false,
  theta: 45
};

let drawProgress = 1;
let intersectionLine = null;

const modelGroup = new THREE.Group();
scene.add(modelGroup);

const makeMat = (color) => new THREE.MeshStandardMaterial({
  color,
  roughness: 0.35,
  metalness: 0.1,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1
});

const mat1 = makeMat(0x3b82f6);
const mat2 = makeMat(0x10b981);
const edgeMat = new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.65 });
const intersectMat = new THREE.LineBasicMaterial({ color: 0xfacc15 });
const genMat = new THREE.LineBasicMaterial({ color: 0xf87171 });
const pointMat = new THREE.MeshBasicMaterial({ color: 0xf87171 });

function addCylinder(geo, mat) {
  modelGroup.add(new THREE.Mesh(geo, mat));
  modelGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), edgeMat));
}

// Đường sinh của trụ ngang (song song Z) cắt mặt trụ đứng tại 2 điểm
function addGeneratrix() {
  if (!state.showPoint) return;
  const t = (state.theta * Math.PI) / 180;
  const x = state.offsetX + state.r2 * Math.cos(t);
  const y = state.r2 * Math.sin(t);

  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x, y, -4.5),
    new THREE.Vector3(x, y, 4.5)
  ]);
  modelGroup.add(new THREE.Line(geo, genMat));

  if (Math.abs(x) > state.r1) return;
  const z = Math.sqrt(state.r1 * state.r1 - x * x);
  [z, -z].forEach((zz) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), pointMat);
    dot.position.set(x, y, zz);
    modelGroup.add(dot);
  });
}

function applyDrawRange() {
  if (!intersectionLine) return;
  const total = intersectionLine.geometry.attributes.position.count;
  intersectionLine.geometry.setDrawRange(0, Math.floor((total * drawProgress) / 2) * 2);
}

function updateGeometry() {
  while (modelGroup.children.length > 0) {
    const obj = modelGroup.children[0];
    if (obj.geometry) obj.geometry.dispose();
    modelGroup.remove(obj);
  }

  const segs = 36;

  // Trụ đứng (trục Y)
  addCylinder(new THREE.CylinderGeometry(state.r1, state.r1, 8, segs, 1), mat1);

  // Trụ ngang (trục Z), lệch tâm theo X
  const geo2 = new THREE.CylinderGeometry(state.r2, state.r2, 9, segs, 1);
  geo2.rotateX(Math.PI / 2);
  geo2.translate(state.offsetX, 0, 0);
  addCylinder(geo2, mat2);

  const pts = computeIntersection(state.r1, state.r2, state.offsetX);
  if (pts.length > 0) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    intersectionLine = new THREE.LineSegments(geo, intersectMat);
    applyDrawRange();
    modelGroup.add(intersectionLine);
  } else {
    intersectionLine = null;
  }

  addGeneratrix();
  applyRenderMode();
}

// Trụ 1: x² + z² = R1²   |   Trụ 2: (x - e)² + y² = R2²
function computeIntersection(R1, R2, e) {
  const segments = [];
  const steps = 360;

  const sweep = (pointAt) => {
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const curr = pointAt((i / steps) * Math.PI * 2);
      if (curr && prev) segments.push(prev, curr);
      prev = curr;
    }
  };

  // Quét theo góc của trụ 2
  for (const sz of [1, -1]) {
    sweep((t) => {
      const x = e + R2 * Math.cos(t);
      const y = R2 * Math.sin(t);
      if (x * x > R1 * R1) return null;
      return new THREE.Vector3(x, y, sz * Math.sqrt(R1 * R1 - x * x));
    });
  }

  // Quét theo góc của trụ 1 để đường cong khép kín mượt
  for (const sy of [1, -1]) {
    sweep((p) => {
      const x = R1 * Math.cos(p);
      const z = R1 * Math.sin(p);
      const dx = x - e;
      if (dx * dx > R2 * R2) return null;
      return new THREE.Vector3(x, sy * Math.sqrt(R2 * R2 - dx * dx), z);
    });
  }

  return segments;
}

const MODES = {
  solid:     { wireframe: false, transparent: false, opacity: 1.0,  depthWrite: true,  edge: 0.55 },
  xray:      { wireframe: false, transparent: true,  opacity: 0.35, depthWrite: false, edge: 0.35 },
  wireframe: { wireframe: true,  transparent: true,  opacity: 0.25, depthWrite: true,  edge: 0.85 }
};

function applyRenderMode() {
  const m = MODES[state.mode];
  [mat1, mat2].forEach((mat) => {
    mat.wireframe = m.wireframe;
    mat.transparent = m.transparent;
    mat.opacity = m.opacity;
    mat.depthWrite = m.depthWrite;
    mat.needsUpdate = true;
  });
  edgeMat.opacity = m.edge;
}

// --- UI ---
document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.mode = btn.dataset.mode;
    applyRenderMode();
  });
});

function bindSlider(sliderId, valId, key) {
  document.getElementById(sliderId).addEventListener('input', (e) => {
    state[key] = parseFloat(e.target.value);
    document.getElementById(valId).textContent = state[key].toFixed(1);
    updateGeometry();
  });
}
bindSlider('slider-r1', 'val-r1', 'r1');
bindSlider('slider-r2', 'val-r2', 'r2');
bindSlider('slider-offset', 'val-offset', 'offsetX');

document.getElementById('slider-theta').addEventListener('input', (e) => {
  state.theta = parseInt(e.target.value, 10);
  document.getElementById('val-theta').textContent = state.theta + '°';
  updateGeometry();
});

const btnPoint = document.getElementById('btn-point');
btnPoint.addEventListener('click', () => {
  state.showPoint = !state.showPoint;
  btnPoint.classList.toggle('active', state.showPoint);
  btnPoint.textContent = state.showPoint ? 'Ẩn điểm giao' : 'Hiện điểm giao';
  updateGeometry();
});

const panel = document.getElementById('panel');
const btnToggle = document.getElementById('btn-toggle');
btnToggle.addEventListener('click', () => {
  const hidden = panel.classList.toggle('hidden');
  btnToggle.textContent = hidden ? 'Hiện bảng' : 'Ẩn bảng';
});

document.getElementById('btn-draw').addEventListener('click', () => {
  drawProgress = 0;
  applyDrawRange();
});

const VIEWS = {
  front: new THREE.Vector3(0, 0, 14),
  top:   new THREE.Vector3(0, 14, 0.01),
  side:  new THREE.Vector3(14, 0, 0),
  iso:   new THREE.Vector3(8, 6, 10)
};
let targetCamPos = null;

document.querySelectorAll('.view-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    modelGroup.rotation.set(0, 0, 0);
    targetCamPos = VIEWS[btn.dataset.view].clone();
  });
});

const btnRotate = document.getElementById('btn-rotate');
const btnPulse = document.getElementById('btn-pulse');

btnRotate.addEventListener('click', () => {
  state.autoRotate = !state.autoRotate;
  btnRotate.classList.toggle('active', state.autoRotate);
});

btnPulse.addEventListener('click', () => {
  state.pulse = !state.pulse;
  btnPulse.classList.toggle('active', state.pulse);
  if (!state.pulse) modelGroup.scale.set(1, 1, 1);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  Object.assign(state, {
    r1: 2.0, r2: 1.5, offsetX: 0.0, theta: 45,
    mode: 'solid', autoRotate: false, pulse: false, showPoint: false
  });

  [['slider-r1', 'val-r1', state.r1], ['slider-r2', 'val-r2', state.r2], ['slider-offset', 'val-offset', state.offsetX]]
    .forEach(([sid, vid, v]) => {
      document.getElementById(sid).value = v;
      document.getElementById(vid).textContent = v.toFixed(1);
    });
  document.getElementById('slider-theta').value = state.theta;
  document.getElementById('val-theta').textContent = state.theta + '°';

  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'solid'));
  [btnRotate, btnPulse, btnPoint].forEach((b) => b.classList.remove('active'));
  btnPoint.textContent = 'Hiện điểm giao';

  modelGroup.rotation.set(0, 0, 0);
  modelGroup.scale.set(1, 1, 1);
  targetCamPos = VIEWS.iso.clone();
  drawProgress = 1;
  updateGeometry();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Animation ---
const clock = new THREE.Clock();
const origin = new THREE.Vector3();
let lastTime = 0;
updateGeometry();

function animate() {
  requestAnimationFrame(animate);
  const now = clock.getElapsedTime();
  const dt = now - lastTime;
  lastTime = now;

  if (drawProgress < 1) {
    drawProgress = Math.min(1, drawProgress + dt / 3);
    applyDrawRange();
  }

  if (targetCamPos) {
    camera.position.lerp(targetCamPos, 0.1);
    controls.target.lerp(origin, 0.1);
    if (camera.position.distanceTo(targetCamPos) < 0.05) {
      camera.position.copy(targetCamPos);
      targetCamPos = null;
    }
  }

  if (state.autoRotate) modelGroup.rotation.y += 0.01;

  if (state.pulse) {
    const s = 1 + Math.sin(now * 3.5) * 0.06;
    modelGroup.scale.set(s, s, s);
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();