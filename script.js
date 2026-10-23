const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
// Nền trong suốt: gradient được vẽ bằng CSS phía sau canvas

const perspCam = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
perspCam.position.set(8, 6, 10);
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
let camera = perspCam;      // camera đang dùng
let usingOrtho = false;
let orthoHalfH = 8;         // nửa chiều cao khung nhìn trực giao

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 5;
controls.maxDistance = 40;
controls.minZoom = 0.3;
controls.maxZoom = 4;

// Ánh sáng
scene.add(new THREE.HemisphereLight(0xbfdbfe, 0x0f172a, 0.55));
scene.add(new THREE.AmbientLight(0xffffff, 0.35));

const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
dirLight1.position.set(12, 18, 15);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.45);
dirLight2.position.set(-12, -10, -12);
scene.add(dirLight2);

const gridHelper = new THREE.GridHelper(20, 20, 0x334155, 0x1e293b);
gridHelper.position.y = -4.2;
scene.add(gridHelper);

// Trạng thái ứng dụng
const state = {
  shape1: 'cylinder', // 'cylinder' | 'prism'
  shape2: 'cylinder',
  r1: 2.0,
  r2: 1.5,
  offsetX: 0.0,
  rot2: 0,
  mode: 'solid',
  autoRotate: false,
  pulse: false,
  showPoint: false,
  theta: 45
};

const H1 = 8;          // chiều cao khối 1
const L2 = 9;          // chiều dài khối 2
let drawProgress = 0;  // 0 -> 1: vẽ dần đường giao tuyến (chạy luôn lúc mở trang)
let intro = 0;         // 0 -> 1: hiệu ứng khối "nở" ra lúc mở trang
let intersectionLines = [];

// Giá trị đang hiển thị: luôn chạy dần về giá trị đích trong `state` (tạo transition mượt)
// k1/k2: 0 = trụ tròn, 1 = lăng trụ vuông (giá trị giữa = đang biến hình)
const view = {
  r1: state.r1, r2: state.r2, offsetX: state.offsetX, rot2: state.rot2,
  k1: state.shape1 === 'prism' ? 1 : 0,
  k2: state.shape2 === 'prism' ? 1 : 0
};

function stepView(dt) {
  const f = 1 - Math.exp(-dt * 10);
  const target = {
    r1: state.r1, r2: state.r2, offsetX: state.offsetX, rot2: state.rot2,
    k1: state.shape1 === 'prism' ? 1 : 0,
    k2: state.shape2 === 'prism' ? 1 : 0
  };
  let changed = false;
  for (const key in target) {
    const d = target[key] - view[key];
    if (Math.abs(d) > 0.002) { view[key] += d * f; changed = true; }
    else if (d !== 0) { view[key] = target[key]; changed = true; }
  }
  return changed;
}

const modelGroup = new THREE.Group();
scene.add(modelGroup);

const makeMat = (color) => new THREE.MeshStandardMaterial({
  color,
  roughness: 0.3,
  metalness: 0.1,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1
});

const mat1 = makeMat(0x3b82f6);
const mat2 = makeMat(0x10b981);
const edgeMat = new THREE.LineBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.6 });
const intersectMat = new THREE.LineBasicMaterial({ color: 0xfacc15 });
// Phần giao tuyến bị che khuất: hiện mờ như nét khuất trong bản vẽ kỹ thuật
const hiddenMat = new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.22, depthTest: false });
const genMat = new THREE.LineBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.8 });
const pointMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

function addShapeMesh(geo, mat) {
  modelGroup.add(new THREE.Mesh(geo, mat));
  modelGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), edgeMat));
}

/* ---------- Hình học mặt cắt (có biến hình trụ <-> lăng trụ) ---------- */

// Bán kính theo hướng a: k=0 là đường tròn, k=1 là hình vuông cạnh 2r
function radial(r, k, a) {
  const m = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
  return r * (1 + k * (1 / m - 1));
}

// Đa giác mặt cắt khối 1 trong mặt phẳng XZ, dùng để tìm z theo x
let poly1 = [];
function buildPoly1() {
  const N = 192;
  poly1 = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rad = radial(view.r1, view.k1, a);
    poly1.push([rad * Math.cos(a), rad * Math.sin(a)]);
  }
}

// Điểm trên chu vi mặt cắt khối 2, hệ toạ độ cục bộ (chưa xoay, chưa lệch tâm)
function sectionLocal(i, steps) {
  const a = (i / steps) * Math.PI * 2;
  const rad = radial(view.r2, view.k2, a);
  return [rad * Math.cos(a), rad * Math.sin(a)];
}

// Cục bộ -> thế giới: xoay quanh trục khối 2 (trục Z) rồi tịnh tiến theo X
function sectionToWorld(u, v) {
  const a = (view.rot2 * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [view.offsetX + u * c - v * s, u * s + v * c];
}

// [zLớnNhất, zNhỏNhất] của khối 1 tại hoành độ x (hoặc [] nếu x nằm ngoài)
function zHits(x) {
  let zmax = -Infinity, zmin = Infinity;
  const n = poly1.length;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = poly1[i];
    const [x2, z2] = poly1[(i + 1) % n];
    const lo = Math.min(x1, x2) - 1e-6, hi = Math.max(x1, x2) + 1e-6;
    if (x < lo || x > hi) continue;
    const dx = x2 - x1;
    const zs = Math.abs(dx) < 1e-9 ? [z1, z2] : [z1 + ((x - x1) / dx) * (z2 - z1)];
    zs.forEach((z) => { zmax = Math.max(zmax, z); zmin = Math.min(zmin, z); });
  }
  return zmax === -Infinity ? [] : [zmax, zmin];
}

/* ---------- Đường sinh & điểm giao ---------- */

function addGeneratrix() {
  if (!state.showPoint) return;

  // Hướng θ trong hệ thế giới -> hệ cục bộ của mặt cắt
  const a = (state.theta * Math.PI) / 180 - (view.rot2 * Math.PI) / 180;
  const rad = radial(view.r2, view.k2, a);
  const [x, y] = sectionToWorld(rad * Math.cos(a), rad * Math.sin(a));

  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x, y, -L2 / 2),
    new THREE.Vector3(x, y, L2 / 2)
  ]);
  modelGroup.add(new THREE.Line(geo, genMat));

  if (Math.abs(y) > H1 / 2) return;
  zHits(x).forEach((zz) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), pointMat);
    dot.position.set(x, y, zz);
    modelGroup.add(dot);
  });
}

function applyDrawRange() {
  intersectionLines.forEach((line) => {
    const total = line.geometry.attributes.position.count;
    line.geometry.setDrawRange(0, Math.floor((total * drawProgress) / 2) * 2);
  });
}

/* ---------- Dựng mô hình ---------- */

// Khối trung gian giữa trụ tròn (k=0) và lăng trụ vuông (k=1), trục dọc theo Y
function morphGeometry(r, h, k) {
  if (k <= 0) return new THREE.CylinderGeometry(r, r, h, 48, 1);
  if (k >= 1) return new THREE.BoxGeometry(r * 2, h, r * 2);

  const N = 48, pts = [], pos = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rad = radial(r, k, a);
    pts.push([rad * Math.cos(a), rad * Math.sin(a)]);
  }
  const y0 = -h / 2, y1 = h / 2;
  const push = (x, y, z) => pos.push(x, y, z);
  for (let i = 0; i < N; i++) {
    const [px, pz] = pts[i];
    const [qx, qz] = pts[(i + 1) % N];
    // thành bên
    push(px, y0, pz); push(qx, y1, qz); push(qx, y0, qz);
    push(px, y0, pz); push(px, y1, pz); push(qx, y1, qz);
    // nắp trên / nắp dưới
    push(0, y1, 0); push(qx, y1, qz); push(px, y1, pz);
    push(0, y0, 0); push(px, y0, pz); push(qx, y0, qz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function updateGeometry() {
  while (modelGroup.children.length > 0) {
    const obj = modelGroup.children[0];
    if (obj.geometry) obj.geometry.dispose();
    modelGroup.remove(obj);
  }
  buildPoly1();

  // Khối 1 (đứng)
  addShapeMesh(morphGeometry(view.r1, H1, view.k1), mat1);

  // Khối 2 (ngang, trục dọc theo Z)
  const geo2 = morphGeometry(view.r2, L2, view.k2);
  geo2.rotateX(Math.PI / 2);
  if (view.rot2 !== 0) geo2.rotateZ((view.rot2 * Math.PI) / 180);
  geo2.translate(view.offsetX, 0, 0);
  addShapeMesh(geo2, mat2);

  // Đường giao tuyến
  intersectionLines = [];
  const pts = computeIntersectionPoints();
  if (pts.length > 0) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const hidden = new THREE.LineSegments(geo, hiddenMat);
    hidden.renderOrder = 1;
    const main = new THREE.LineSegments(geo, intersectMat);
    main.renderOrder = 2;
    intersectionLines.push(hidden, main);
    modelGroup.add(hidden, main);
    applyDrawRange();
  }

  addGeneratrix();
  applyRenderMode();
}

// Giao tuyến = các điểm trên chu vi mặt cắt khối 2 nằm trên mặt khối 1
function computeIntersectionPoints() {
  const segments = [];
  const steps = 360;

  for (const sz of [1, -1]) {
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const [u, v] = sectionLocal(i, steps);
      const [x, y] = sectionToWorld(u, v);

      let curr = null;
      if (Math.abs(y) <= H1 / 2) {
        const zs = zHits(x);
        if (zs.length) curr = new THREE.Vector3(x, y, sz > 0 ? zs[0] : zs[1]);
      }
      if (curr && prev) segments.push(prev, curr);
      prev = curr;
    }
  }
  return segments;
}

const MODES = {
  solid:     { wireframe: false, transparent: false, opacity: 1.0,  depthWrite: true,  edge: 0.6 },
  xray:      { wireframe: false, transparent: true,  opacity: 0.35, depthWrite: false, edge: 0.4 },
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

/* ---------- UI ---------- */

function bindGroup(selector, dataKey, stateKey) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(selector).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state[stateKey] = btn.dataset[dataKey];
      updateGeometry();
    });
  });
}
bindGroup('.shape-btn-1', 'shape1', 'shape1');
bindGroup('.shape-btn-2', 'shape2', 'shape2');

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.mode = btn.dataset.mode;
    applyRenderMode();
  });
});

function bindSlider(sliderId, valId, key, { decimals = 1, suffix = '' } = {}) {
  document.getElementById(sliderId).addEventListener('input', (e) => {
    state[key] = parseFloat(e.target.value);
    document.getElementById(valId).textContent = state[key].toFixed(decimals) + suffix;
    updateGeometry();
  });
}
bindSlider('slider-r1', 'val-r1', 'r1');
bindSlider('slider-r2', 'val-r2', 'r2');
bindSlider('slider-offset', 'val-offset', 'offsetX');
bindSlider('slider-rot2', 'val-rot2', 'rot2', { decimals: 0, suffix: '°' });
bindSlider('slider-theta', 'val-theta', 'theta', { decimals: 0, suffix: '°' });

const btnPoint = document.getElementById('btn-point');
btnPoint.addEventListener('click', () => {
  state.showPoint = !state.showPoint;
  btnPoint.classList.toggle('active', state.showPoint);
  btnPoint.textContent = state.showPoint ? 'Ẩn đường sinh' : 'Hiện đường sinh & điểm giao';
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

/* ---------- Chuyển góc nhìn mượt (nội suy theo toạ độ cầu) ---------- */

const VIEWS = {
  front: new THREE.Vector3(0, 0, 14),
  top:   new THREE.Vector3(0, 14, 0.01),
  side:  new THREE.Vector3(14, 0, 0),
  iso:   new THREE.Vector3(8, 6, 10)
};
const origin = new THREE.Vector3();
const TWO_PI = Math.PI * 2;
const wrapPi = (a) => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

let tween = null;

function flyTo(viewName) {
  const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const to = new THREE.Spherical().setFromVector3(VIEWS[viewName]);
  tween = {
    from, to,
    dTheta: wrapPi(to.theta - from.theta), // đi đường ngắn nhất
    fromTarget: controls.target.clone(),
    fromRot: wrapPi(modelGroup.rotation.y),
    t: 0
  };
}

// Người dùng kéo chuột giữa chừng thì huỷ chuyển động, tránh giật
controls.addEventListener('start', () => { tween = null; });

function updateOrthoFrustum() {
  const aspect = window.innerWidth / window.innerHeight;
  orthoCam.left = -orthoHalfH * aspect;
  orthoCam.right = orthoHalfH * aspect;
  orthoCam.top = orthoHalfH;
  orthoCam.bottom = -orthoHalfH;
  orthoCam.updateProjectionMatrix();
}
updateOrthoFrustum();

// Đổi giữa camera phối cảnh <-> trực giao, giữ nguyên kích thước hiển thị
function setProjection(ortho) {
  if (ortho === usingOrtho) return;
  const dir = camera.position.clone().sub(controls.target);
  const t = Math.tan(THREE.MathUtils.degToRad(perspCam.fov / 2));
  const next = ortho ? orthoCam : perspCam;

  if (ortho) {
    orthoHalfH = dir.length() * t;
    orthoCam.zoom = 1;
    updateOrthoFrustum();
  } else {
    dir.setLength(orthoHalfH / orthoCam.zoom / t);
  }

  next.position.copy(controls.target).add(dir);
  next.quaternion.copy(camera.quaternion);
  camera = next;
  controls.object = next;
  usingOrtho = ortho;

  const btn = document.getElementById('btn-proj');
  btn.textContent = ortho ? 'Camera: Trực giao' : 'Camera: Phối cảnh';
  btn.classList.toggle('active', ortho);
  controls.update();
}

document.getElementById('btn-proj').addEventListener('click', () => setProjection(!usingOrtho));

// Giống Blender: các mặt chiếu dùng trực giao, góc 3D dùng phối cảnh
document.querySelectorAll('.view-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    setProjection(btn.dataset.view !== 'iso');
    flyTo(btn.dataset.view);
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
});

document.getElementById('btn-reset').addEventListener('click', () => {
  Object.assign(state, {
    shape1: 'cylinder', shape2: 'cylinder',
    r1: 2.0, r2: 1.5, offsetX: 0.0, rot2: 0, theta: 45,
    mode: 'solid', autoRotate: false, pulse: false, showPoint: false
  });

  document.querySelectorAll('.shape-btn-1').forEach((b) => b.classList.toggle('active', b.dataset.shape1 === 'cylinder'));
  document.querySelectorAll('.shape-btn-2').forEach((b) => b.classList.toggle('active', b.dataset.shape2 === 'cylinder'));

  [['slider-r1', 'val-r1', state.r1], ['slider-r2', 'val-r2', state.r2], ['slider-offset', 'val-offset', state.offsetX]]
    .forEach(([sid, vid, v]) => {
      document.getElementById(sid).value = v;
      document.getElementById(vid).textContent = v.toFixed(1);
    });

  document.getElementById('slider-rot2').value = 0;
  document.getElementById('val-rot2').textContent = '0°';
  document.getElementById('slider-theta').value = 45;
  document.getElementById('val-theta').textContent = '45°';

  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'solid'));
  [btnRotate, btnPulse, btnPoint].forEach((b) => b.classList.remove('active'));
  btnPoint.textContent = 'Hiện đường sinh & điểm giao';

  setProjection(false);
  flyTo('iso');
  drawProgress = 0;
  intro = 0;
  updateGeometry();
});

window.addEventListener('resize', () => {
  perspCam.aspect = window.innerWidth / window.innerHeight;
  perspCam.updateProjectionMatrix();
  updateOrthoFrustum();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------- Animation loop ---------- */

const clock = new THREE.Clock();
let lastTime = 0;
updateGeometry();

function animate() {
  requestAnimationFrame(animate);
  const now = clock.getElapsedTime();
  const dt = Math.min(now - lastTime, 0.05);
  lastTime = now;

  // Hiệu ứng mở đầu: khối nở ra + giao tuyến được vẽ dần
  if (intro < 1) intro = Math.min(1, intro + dt / 0.9);
  if (drawProgress < 1) {
    drawProgress = Math.min(1, drawProgress + dt / 2.5);
    applyDrawRange();
  }

  // Transition kích thước / lệch tâm / góc xoay / trụ <-> lăng trụ
  if (stepView(dt)) updateGeometry();

  // Chuyển góc nhìn
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 0.9);
    const e = easeInOut(tween.t);
    const { from, to } = tween;

    controls.target.lerpVectors(tween.fromTarget, origin, e);
    const s = new THREE.Spherical(
      from.radius + (to.radius - from.radius) * e,
      from.phi + (to.phi - from.phi) * e,
      from.theta + tween.dTheta * e
    );
    camera.position.setFromSpherical(s).add(controls.target);
    modelGroup.rotation.y = tween.fromRot * (1 - e);

    if (tween.t >= 1) tween = null;
  } else if (state.autoRotate) {
    modelGroup.rotation.y += 0.008;
  }

  // Scale = hiệu ứng mở đầu x hiệu ứng "thở"
  const pulse = state.pulse ? 1 + Math.sin(now * 3) * 0.05 : 1;
  const sc = (0.85 + 0.15 * easeOut(intro)) * pulse;
  modelGroup.scale.set(sc, sc, sc);

  controls.update();
  renderer.render(scene, camera);
}

animate();