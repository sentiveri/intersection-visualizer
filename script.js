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
  mode: 'solid',
  autoRotate: false,
  pulse: false,
  showPoint: false,
  theta: 45,
  axis: 'y',          // trục xoay (tự động + thanh trượt)
  target: 'all'       // hình đang được chọn để xoay: 'all' | 'b1' | 'b2'
};

const H1 = 8;          // chiều cao khối 1
const L2 = 9;          // chiều dài khối 2
let drawProgress = 0;  // 0 -> 1: vẽ dần đường giao tuyến (chạy luôn lúc mở trang)
let intro = 0;         // 0 -> 1: hiệu ứng khối "nở" ra lúc mở trang
let intersectionLines = [];

const TWO_PI = Math.PI * 2;
const wrapPi = (a) => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// Giá trị đang hiển thị: luôn chạy dần về giá trị đích trong `state` (tạo transition mượt)
// k1/k2: 0 = trụ tròn, 1 = lăng trụ vuông (giá trị giữa = đang biến hình)
const view = {
  r1: state.r1, r2: state.r2, offsetX: state.offsetX,
  k1: state.shape1 === 'prism' ? 1 : 0,
  k2: state.shape2 === 'prism' ? 1 : 0
};

function stepView(dt) {
  const f = 1 - Math.exp(-dt * 10);
  const target = {
    r1: state.r1, r2: state.r2, offsetX: state.offsetX,
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

// Góc xoay (radian) của từng hình: 'all' = cả mô hình, 'b1' = khối 1, 'b2' = khối 2
// cur = góc đang hiển thị, tgt = góc đích (cur chạy dần về tgt)
const mkSpin = () => ({ cur: { x: 0, y: 0, z: 0 }, tgt: { x: 0, y: 0, z: 0 } });
const spins = { all: mkSpin(), b1: mkSpin(), b2: mkSpin() };
const AXES = ['x', 'y', 'z'];

// Cập nhật thanh trượt theo hình đang chọn
function syncSpinUI() {
  const t = spins[state.target].tgt;
  AXES.forEach((ax) => {
    const deg = Math.round((wrapPi(t[ax]) * 180) / Math.PI);
    document.getElementById('slider-spin-' + ax).value = deg;
    document.getElementById('val-spin-' + ax).textContent = deg + '°';
  });
}

// Trả về true nếu góc của khối 1 / khối 2 thay đổi (cần dựng lại giao tuyến)
function stepSpins(dt, skipAll) {
  const f = 1 - Math.exp(-dt * 10);
  let poseChanged = false;
  for (const key of ['all', 'b1', 'b2']) {
    if (key === 'all' && skipAll) continue;
    const s = spins[key];
    for (const ax of AXES) {
      if (state.autoRotate && key === state.target && ax === state.axis) continue;
      const d = s.tgt[ax] - s.cur[ax];
      if (d === 0) continue;
      s.cur[ax] = Math.abs(d) < 0.0005 ? s.tgt[ax] : s.cur[ax] + d * f;
      if (key !== 'all') poseChanged = true;
    }
  }
  return poseChanged;
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

/* ---------- Hình học ---------- */

// Bán kính theo hướng a: k=0 là đường tròn, k=1 là hình vuông cạnh 2r
function radial(r, k, a) {
  const m = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
  return r * (1 + k * (1 / m - 1));
}

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

// Mỗi hình là một Group (mesh + cạnh) để xoay / dời độc lập
function makeShape(geo, mat) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeMat));
  modelGroup.add(g);
  return g;
}

/* ---------- Giao tuyến tổng quát (mặt lưới ∩ mặt lưới) ---------- */

const EPS = 1e-6;
const _d = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const _h = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Vector3();

// Danh sách tam giác của một hình, đã đưa về toạ độ của modelGroup
function getTris(group, geo) {
  group.updateMatrix();
  const m = group.matrix;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  const get = (i) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
  const tris = [];
  for (let i = 0; i < n; i += 3) {
    const a = get(i), b = get(i + 1), c = get(i + 2);
    tris.push({
      a, b, c,
      min: new THREE.Vector3(Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.min(a.z, b.z, c.z)),
      max: new THREE.Vector3(Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y), Math.max(a.z, b.z, c.z))
    });
  }
  return tris;
}

// Giao điểm của đoạn thẳng p->q với một tam giác (hoặc null)
function segTri(p, q, tri) {
  _d.subVectors(q, p);
  _e1.subVectors(tri.b, tri.a);
  _e2.subVectors(tri.c, tri.a);
  _h.crossVectors(_d, _e2);
  const det = _e1.dot(_h);
  if (Math.abs(det) < 1e-12) return null;
  const f = 1 / det;
  _s.subVectors(p, tri.a);
  const u = f * _s.dot(_h);
  if (u < -EPS || u > 1 + EPS) return null;
  _q.crossVectors(_s, _e1);
  const v = f * _d.dot(_q);
  if (v < -EPS || u + v > 1 + EPS) return null;
  const t = f * _e2.dot(_q);
  if (t < -EPS || t > 1 + EPS) return null;
  return new THREE.Vector3().copy(p).addScaledVector(_d, t);
}

// Đoạn giao của hai tam giác -> đẩy 2 điểm vào out
function triTri(ta, tb, out) {
  const pts = [];
  const add = (p) => {
    if (p && !pts.some((q) => q.distanceToSquared(p) < 1e-10)) pts.push(p);
  };
  add(segTri(ta.a, ta.b, tb)); add(segTri(ta.b, ta.c, tb)); add(segTri(ta.c, ta.a, tb));
  add(segTri(tb.a, tb.b, ta)); add(segTri(tb.b, tb.c, ta)); add(segTri(tb.c, tb.a, ta));
  if (pts.length < 2) return;

  let bi = 0, bj = 1, bd = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = pts[i].distanceToSquared(pts[j]);
      if (d > bd) { bd = d; bi = i; bj = j; }
    }
  }
  if (bd > 1e-8) out.push(pts[bi], pts[bj]);
}

function computeIntersectionPoints(tris1, tris2) {
  const out = [];
  for (const tb of tris2) {
    for (const ta of tris1) {
      if (ta.min.x > tb.max.x || ta.max.x < tb.min.x ||
          ta.min.y > tb.max.y || ta.max.y < tb.min.y ||
          ta.min.z > tb.max.z || ta.max.z < tb.min.z) continue;
      triTri(ta, tb, out);
    }
  }
  return out;
}

/* ---------- Đường sinh & điểm giao ---------- */

// Đường sinh chạy dọc trục khối 2 tại góc θ của mặt cắt; điểm giao với khối 1 là các chấm đỏ
function addGeneratrix(g2, tris1) {
  if (!state.showPoint) return;

  const a = (state.theta * Math.PI) / 180;
  const rad = radial(view.r2, view.k2, a);
  const u = rad * Math.cos(a), v = rad * Math.sin(a);
  const p = new THREE.Vector3(u, v, -L2 / 2).applyMatrix4(g2.matrix);
  const q = new THREE.Vector3(u, v, L2 / 2).applyMatrix4(g2.matrix);

  modelGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), genMat));

  const hits = [];
  tris1.forEach((tri) => {
    const h = segTri(p, q, tri);
    if (h && !hits.some((o) => o.distanceToSquared(h) < 1e-6)) hits.push(h);
  });
  hits.forEach((h) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), pointMat);
    dot.position.copy(h);
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

function clearGroup() {
  while (modelGroup.children.length > 0) {
    const obj = modelGroup.children[0];
    obj.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
    modelGroup.remove(obj);
  }
}

function updateGeometry() {
  clearGroup();

  // Khối 1 (đứng, trục Y)
  const geo1 = morphGeometry(view.r1, H1, view.k1);
  const g1 = makeShape(geo1, mat1);
  g1.rotation.set(spins.b1.cur.x, spins.b1.cur.y, spins.b1.cur.z);

  // Khối 2 (ngang, trục Z)
  const geo2 = morphGeometry(view.r2, L2, view.k2);
  geo2.rotateX(Math.PI / 2);
  const g2 = makeShape(geo2, mat2);
  g2.position.set(view.offsetX, 0, 0);
  g2.rotation.set(spins.b2.cur.x, spins.b2.cur.y, spins.b2.cur.z);

  g1.updateMatrix();
  g2.updateMatrix();
  const tris1 = getTris(g1, geo1);
  const tris2 = getTris(g2, geo2);

  // Đường giao tuyến
  intersectionLines = [];
  const pts = computeIntersectionPoints(tris1, tris2);
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

  addGeneratrix(g2, tris1);
  applyRenderMode();
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

let tween = null;

function flyTo(viewName) {
  const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const to = new THREE.Spherical().setFromVector3(VIEWS[viewName]);
  const r = spins.all.cur;
  tween = {
    from, to,
    dTheta: wrapPi(to.theta - from.theta), // đi đường ngắn nhất
    fromTarget: controls.target.clone(),
    fromRot: { x: wrapPi(r.x), y: wrapPi(r.y), z: wrapPi(r.z) }, // cả mô hình quay về 0
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

// Thanh trượt xoay: áp dụng cho hình đang chọn
AXES.forEach((ax) => {
  document.getElementById('slider-spin-' + ax).addEventListener('input', (e) => {
    spins[state.target].tgt[ax] = (parseFloat(e.target.value) * Math.PI) / 180;
    document.getElementById('val-spin-' + ax).textContent = e.target.value + '°';
    if (state.target === 'all') tween = null;
  });
});

// Chọn trục xoay tự động
document.querySelectorAll('.axis-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.axis-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.axis = btn.dataset.axis;
  });
});

// Chọn hình muốn xoay: cả mô hình / khối 1 / khối 2
document.querySelectorAll('.target-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.target-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.target = btn.dataset.target;
    syncSpinUI();
  });
});

document.getElementById('btn-reset').addEventListener('click', () => {
  Object.assign(state, {
    shape1: 'cylinder', shape2: 'cylinder',
    r1: 2.0, r2: 1.5, offsetX: 0.0, theta: 45,
    mode: 'solid', autoRotate: false, pulse: false, showPoint: false,
    axis: 'y', target: 'all'
  });

  document.querySelectorAll('.shape-btn-1').forEach((b) => b.classList.toggle('active', b.dataset.shape1 === 'cylinder'));
  document.querySelectorAll('.shape-btn-2').forEach((b) => b.classList.toggle('active', b.dataset.shape2 === 'cylinder'));

  [['slider-r1', 'val-r1', state.r1], ['slider-r2', 'val-r2', state.r2], ['slider-offset', 'val-offset', state.offsetX]]
    .forEach(([sid, vid, v]) => {
      document.getElementById(sid).value = v;
      document.getElementById(vid).textContent = v.toFixed(1);
    });

  document.getElementById('slider-theta').value = 45;
  document.getElementById('val-theta').textContent = '45°';

  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'solid'));
  [btnRotate, btnPulse, btnPoint].forEach((b) => b.classList.remove('active'));
  btnPoint.textContent = 'Hiện đường sinh & điểm giao';

  // Góc xoay: trả hết về 0 (cả mô hình do flyTo xử lý)
  ['all', 'b1', 'b2'].forEach((k) => AXES.forEach((ax) => { spins[k].tgt[ax] = 0; }));
  document.querySelectorAll('.axis-btn').forEach((b) => b.classList.toggle('active', b.dataset.axis === 'y'));
  document.querySelectorAll('.target-btn').forEach((b) => b.classList.toggle('active', b.dataset.target === 'all'));
  syncSpinUI();

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

  // Transition kích thước / lệch tâm / trụ <-> lăng trụ
  let dirty = stepView(dt);

  // Chuyển góc nhìn (đồng thời đưa cả mô hình về góc 0)
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

    AXES.forEach((ax) => {
      const v = tween.fromRot[ax] * (1 - e);
      spins.all.cur[ax] = v;
      spins.all.tgt[ax] = v;
    });
    syncSpinUI();

    if (tween.t >= 1) tween = null;
  }

  // Xoay tự động quanh trục đã chọn, cho hình đã chọn
  if (state.autoRotate && !(tween && state.target === 'all')) {
    const sp = spins[state.target];
    sp.cur[state.axis] = wrapPi(sp.cur[state.axis] + dt * 0.5);
    sp.tgt[state.axis] = sp.cur[state.axis];
    if (state.target !== 'all') dirty = true;
    syncSpinUI();
  }

  // Transition khi kéo thanh trượt xoay: góc chạy mượt về giá trị đích
  if (stepSpins(dt, !!tween)) dirty = true;

  // Khối 1 / khối 2 đổi vị trí hay góc -> dựng lại và tính lại giao tuyến
  if (dirty) updateGeometry();

  const r = spins.all.cur;
  modelGroup.rotation.set(r.x, r.y, r.z);

  // Scale = hiệu ứng mở đầu x hiệu ứng "thở"
  const pulse = state.pulse ? 1 + Math.sin(now * 3) * 0.05 : 1;
  const sc = (0.85 + 0.15 * easeOut(intro)) * pulse;
  modelGroup.scale.set(sc, sc, sc);

  controls.update();
  renderer.render(scene, camera);
}

animate();