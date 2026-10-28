import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class BioArchipelagoScene {
  constructor({
    container,
    labelsContainer,
    svgLayer,
    data,
    onSelectIsland,
    isReducedMotion
  }) {
    this.container = container;
    this.labelsContainer = labelsContainer;
    this.svgLayer = svgLayer;
    this.data = data;
    this.onSelectIsland = onSelectIsland;
    this.reducedMotion = Boolean(isReducedMotion);

    this.currentTheme = 'morning';
    this.currentLightMode = 'day';
    this.selectedIslandId = null;
    this.searchQuery = '';
    this.visitedSet = new Set();

    this.islandNodes = new Map(); // id -> { group, hitMeshes, anchor, labelEl, lineEl, dotEl, animators }
    this.windowMaterials = [];
    this.lampLights = [];
    this.walkers = [];
    this.animatedObjects = [];
    this.cameraTween = null;

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointerDownPos = new THREE.Vector2();

    this.init();
  }

  init() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf6f0e4);
    this.scene.fog = new THREE.FogExp2(0xf6f0e4, 0.0042);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 1, 500);
    this.defaultCameraPos = new THREE.Vector3(0, 68, 108);
    this.defaultTarget = new THREE.Vector3(0, 0, 4);
    this.camera.position.copy(this.defaultCameraPos);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.defaultTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.minPolarAngle = 0.2;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 175;
    this.controls.update();

    this.setupLights();
    this.buildOcean();
    this.buildArchipelago();
    this.buildBridgesAndPaths();
    this.buildWalkers();
    this.bindEvents();

    this.applyThemeColors(this.currentTheme);
    this.applyLightMode(this.currentLightMode);

    this.animate = this.animate.bind(this);
    this.rafId = requestAnimationFrame(this.animate);
  }

  setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0xd8cfc0, 0.65);
    this.hemiLight.position.set(0, 80, 0);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff7e8, 1.35);
    this.dirLight.position.set(45, 75, 40);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 220;
    const d = 80;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.scene.add(this.dirLight);

    // Shared reactive window material that glows at night/dusk
    this.sharedWindowMat = new THREE.MeshStandardMaterial({
      color: 0xffefc2,
      emissive: 0xffb347,
      emissiveIntensity: 0.15,
      roughness: 0.2
    });
    this.windowMaterials.push(this.sharedWindowMat);
  }

  buildOcean() {
    const seaGeo = new THREE.CylinderGeometry(220, 220, 4, 48);
    this.seaMat = new THREE.MeshStandardMaterial({
      color: 0x6dc0b8,
      roughness: 0.35,
      metalness: 0.08
    });
    this.seaMesh = new THREE.Mesh(seaGeo, this.seaMat);
    this.seaMesh.position.y = -2.4;
    this.seaMesh.receiveShadow = true;
    this.scene.add(this.seaMesh);

    // Decorative subtle water ripples
    this.ripplesGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(1, 1.18, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.rippleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide
    });

    const centerRipple = new THREE.Mesh(ringGeo.clone().scale(15, 1, 15), this.rippleMat);
    centerRipple.position.set(0, -0.32, 0);
    this.ripplesGroup.add(centerRipple);

    this.data.islands.forEach((isl) => {
      const r = new THREE.Mesh(ringGeo.clone().scale(8.5, 1, 8.5), this.rippleMat);
      r.position.set(isl.position.x, -0.32, isl.position.z);
      this.ripplesGroup.add(r);
    });
    this.scene.add(this.ripplesGroup);
  }

  buildArchipelago() {
    // 1. Build Central Island (科科大島)
    const centerInfo = {
      ...this.data.centerIsland,
      position: { x: 0, z: 0 },
      isCenter: true
    };
    this.createIslandNode(centerInfo, 12.5);

    // 2. Build 11 Tool Islands
    this.data.islands.forEach((isl) => {
      this.createIslandNode(isl, 7.2);
    });
  }

  createIslandNode(islandData, radius) {
    const group = new THREE.Group();
    group.position.set(islandData.position.x, 0, islandData.position.z);

    const hitMeshes = [];

    // Low-poly rock/sand/grass tiered island base
    const rockGeo = new THREE.CylinderGeometry(radius * 0.92, radius * 0.68, 3.2, 10);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b7e74, roughness: 0.9 });
    const rockMesh = new THREE.Mesh(rockGeo, rockMat);
    rockMesh.position.y = -1.1;
    rockMesh.receiveShadow = true;
    group.add(rockMesh);

    const sandGeo = new THREE.CylinderGeometry(radius * 1.0, radius * 0.94, 0.9, 12);
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xead4aa, roughness: 0.85 });
    const sandMesh = new THREE.Mesh(sandGeo, sandMat);
    sandMesh.position.y = 0.2;
    sandMesh.receiveShadow = true;
    group.add(sandMesh);

    let turfColor = 0x5ea87c;
    if (islandData.group === '基礎計算') turfColor = 0x56a886;
    if (islandData.group === '蛋白質電泳') turfColor = 0x4f9da6;
    if (islandData.group === '蛋白質分析') turfColor = 0x6e9d64;
    if (islandData.isCenter) turfColor = 0x4ca37b;

    const turfGeo = new THREE.CylinderGeometry(radius * 0.92, radius * 0.97, 0.8, 12);
    const turfMat = new THREE.MeshStandardMaterial({ color: turfColor, roughness: 0.8 });
    const turfMesh = new THREE.Mesh(turfGeo, turfMat);
    turfMesh.position.y = 0.85;
    turfMesh.receiveShadow = true;
    turfMesh.castShadow = true;
    group.add(turfMesh);
    hitMeshes.push(turfMesh, sandMesh);

    // Build specific landmark on top of y = 1.25
    const landmarkGroup = new THREE.Group();
    landmarkGroup.position.y = 1.25;

    if (islandData.isCenter) {
      this.buildCenterLandmark(landmarkGroup);
      this.addTreesAndLamps(landmarkGroup, radius, 5);
    } else {
      this.buildToolLandmark(landmarkGroup, islandData.landmarkType);
      this.addTreesAndLamps(landmarkGroup, radius, 2);
    }

    landmarkGroup.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData.islandId = islandData.id;
        hitMeshes.push(child);
      }
    });
    turfMesh.userData.islandId = islandData.id;
    sandMesh.userData.islandId = islandData.id;

    group.add(landmarkGroup);
    this.scene.add(group);

    // Create 2D label & SVG leader line
    const labelEl = document.createElement('button');
    labelEl.type = 'button';
    labelEl.className = `island-label${islandData.isCenter ? ' is-center' : ''}`;
    labelEl.dataset.islandId = islandData.id;
    labelEl.setAttribute('aria-label', `${islandData.isCenter ? '中央島' : `第 ${islandData.order} 島`}：${islandData.name}`);

    const numSpan = document.createElement('span');
    numSpan.className = 'label-num';
    numSpan.textContent = islandData.isCenter ? '★' : `#${islandData.order}`;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'label-name';
    nameSpan.textContent = islandData.name;

    const visitedSpan = document.createElement('span');
    visitedSpan.className = 'label-visited';
    visitedSpan.textContent = '';

    labelEl.append(numSpan, nameSpan, visitedSpan);
    labelEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSelectIsland(islandData.id);
    });
    this.labelsContainer.appendChild(labelEl);

    const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lineEl.setAttribute('stroke', '#2f7a6b');
    lineEl.setAttribute('stroke-width', '1.6');
    lineEl.setAttribute('stroke-dasharray', '3,3');
    lineEl.style.opacity = '0';
    this.svgLayer.appendChild(lineEl);

    const dotEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dotEl.setAttribute('r', '3.2');
    dotEl.setAttribute('fill', '#d9792f');
    dotEl.style.opacity = '0';
    this.svgLayer.appendChild(dotEl);

    const anchorHeight = islandData.isCenter ? 11.5 : 8.2;
    const anchor = new THREE.Vector3(islandData.position.x, anchorHeight, islandData.position.z);

    this.islandNodes.set(islandData.id, {
      id: islandData.id,
      data: islandData,
      group,
      landmarkGroup,
      hitMeshes,
      anchor,
      labelEl,
      visitedSpan,
      lineEl,
      dotEl
    });
  }

  buildCenterLandmark(parent) {
    // Stepped stone plaza
    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(8.2, 8.8, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d5, roughness: 0.7 })
    );
    plaza.position.y = 0.25;
    parent.add(plaza);

    // Central Bio-Lab Main Tower
    const mainHall = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 4.5, 5.2),
      new THREE.MeshStandardMaterial({ color: 0xfaf7f0, roughness: 0.6 })
    );
    mainHall.position.set(0, 2.5, -1.8);
    parent.add(mainHall);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(5.0, 2.4, 4),
      new THREE.MeshStandardMaterial({ color: 0x2f7a6b, roughness: 0.5 })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 5.9, -1.8);
    parent.add(roof);

    // Windows on Main Hall
    for (let x = -1.8; x <= 1.8; x += 1.8) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.15), this.sharedWindowMat);
      win.position.set(x, 2.8, 0.82);
      parent.add(win);
    }

    // Floating DNA / Science Helix Crest on Top
    const crestGroup = new THREE.Group();
    crestGroup.position.set(0, 8.2, -1.8);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.18, 12, 24),
      new THREE.MeshStandardMaterial({ color: 0xd9792f, metalness: 0.3, roughness: 0.3 })
    );
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.65, 0),
      new THREE.MeshStandardMaterial({ color: 0x38b2ac, emissive: 0x1d6f6a, emissiveIntensity: 0.4 })
    );
    crestGroup.add(ring, core);
    parent.add(crestGroup);
    this.animatedObjects.push((t) => {
      crestGroup.rotation.y = t * 0.9;
      crestGroup.position.y = 8.2 + Math.sin(t * 2) * 0.22;
    });

    // Q-Version Grandpa Statue in the Front Fountain Plaza
    const fountain = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.7, 0.7, 16),
      new THREE.MeshStandardMaterial({ color: 0xd0cbc0, roughness: 0.7 })
    );
    fountain.position.set(0, 0.6, 3.6);
    parent.add(fountain);

    const waterPool = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 2.0, 0.75, 16),
      new THREE.MeshStandardMaterial({ color: 0x4fc3d9, roughness: 0.2 })
    );
    waterPool.position.set(0, 0.62, 3.6);
    parent.add(waterPool);

    // Grandpa Figure (White lab coat, glasses, white hair, pipette)
    const grandpa = new THREE.Group();
    grandpa.position.set(0, 1.0, 3.6);

    const coat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.75, 1.8, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
    );
    coat.position.y = 0.9;
    grandpa.add(coat);

    const tie = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.8, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x2f7a6b })
    );
    tie.position.set(0, 1.15, 0.55);
    grandpa.add(tie);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 14, 14),
      new THREE.MeshStandardMaterial({ color: 0xffdfc4, roughness: 0.6 })
    );
    head.position.y = 2.25;
    grandpa.add(head);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })
    );
    hair.position.set(0, 2.32, -0.05);
    grandpa.add(hair);

    // Glasses
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1f4e45, metalness: 0.5 });
    const leftGlass = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, 16), glassMat);
    leftGlass.position.set(-0.2, 2.28, 0.53);
    const rightGlass = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, 16), glassMat);
    rightGlass.position.set(0.2, 2.28, 0.53);
    grandpa.add(leftGlass, rightGlass);

    // Mustache
    const mustache = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.16, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    mustache.position.set(0, 2.02, 0.55);
    grandpa.add(mustache);

    // Giant Micropipette in Grandpa's hand
    const pipette = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.04, 1.9, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f7a6b })
    );
    pipette.position.set(0.75, 1.6, 0.3);
    pipette.rotation.z = -0.25;
    grandpa.add(pipette);

    parent.add(grandpa);
  }

  buildToolLandmark(parent, type) {
    switch (type) {
      case 'calculator': {
        // #1 科科計算器：巨型科學計算機實驗屋＋刻度量筒塔
        const calcBody = new THREE.Mesh(
          new THREE.BoxGeometry(3.8, 4.4, 2.4),
          new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.5 })
        );
        calcBody.position.set(-0.8, 2.2, 0);
        calcBody.rotation.x = -0.12;
        parent.add(calcBody);

        // Screen
        const screen = new THREE.Mesh(
          new THREE.BoxGeometry(3.0, 1.0, 0.2),
          new THREE.MeshStandardMaterial({ color: 0xa8e6cf, emissive: 0x3b8d6e, emissiveIntensity: 0.35 })
        );
        screen.position.set(-0.8, 3.4, 1.15);
        screen.rotation.x = -0.12;
        parent.add(screen);

        // Calculator buttons
        const btnColors = [0xd9792f, 0x2f7a6b, 0xf0f4f8, 0xf0f4f8];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const btn = new THREE.Mesh(
              new THREE.BoxGeometry(0.7, 0.48, 0.25),
              new THREE.MeshStandardMaterial({ color: btnColors[(r + c) % btnColors.length] })
            );
            btn.position.set(-1.7 + c * 0.9, 2.2 - r * 0.7, 1.2 + r * 0.08);
            parent.add(btn);
          }
        }

        // Graduated Cylinder with Blue Solution
        const cylOuter = new THREE.Mesh(
          new THREE.CylinderGeometry(1.0, 1.0, 4.8, 14),
          new THREE.MeshStandardMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.65, roughness: 0.2 })
        );
        cylOuter.position.set(2.4, 2.4, 0.4);
        const cylLiquid = new THREE.Mesh(
          new THREE.CylinderGeometry(0.84, 0.84, 3.2, 14),
          new THREE.MeshStandardMaterial({ color: 0x2980b9, roughness: 0.3 })
        );
        cylLiquid.position.set(2.4, 1.6, 0.4);
        parent.add(cylOuter, cylLiquid);
        break;
      }

      case 'molecule': {
        // #2 常用化學藥品分子量查詢/計算：六角苯環分子結構塔＋琥珀色藥瓶倉庫
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(1.5, 1.5, 3.2, 14),
          new THREE.MeshStandardMaterial({ color: 0xb85d19, roughness: 0.3 })
        );
        bottle.position.set(-1.8, 1.6, -0.5);
        const neck = new THREE.Mesh(
          new THREE.CylinderGeometry(0.75, 0.9, 0.8, 12),
          new THREE.MeshStandardMaterial({ color: 0xb85d19, roughness: 0.3 })
        );
        neck.position.set(-1.8, 3.5, -0.5);
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.85, 0.85, 0.6, 12),
          new THREE.MeshStandardMaterial({ color: 0x2980b9 })
        );
        cap.position.set(-1.8, 4.1, -0.5);
        const label = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 1.4, 0.2),
          this.sharedWindowMat
        );
        label.position.set(-1.8, 1.7, 0.95);
        parent.add(bottle, neck, cap, label);

        // Rotating Hexagonal Molecule Ring
        const molGroup = new THREE.Group();
        molGroup.position.set(1.8, 3.6, 0.6);
        const atomGeo = new THREE.SphereGeometry(0.45, 12, 12);
        const matC = new THREE.MeshStandardMaterial({ color: 0x2f7a6b, roughness: 0.3 });
        const matO = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.3 });
        const r = 1.65;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const atom = new THREE.Mesh(atomGeo, i % 2 === 0 ? matC : matO);
          atom.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
          molGroup.add(atom);

          const nextA = ((i + 1) / 6) * Math.PI * 2;
          const bond = new THREE.Mesh(
            new THREE.CylinderGeometry(0.11, 0.11, r, 8),
            new THREE.MeshStandardMaterial({ color: 0xdfe6e9 })
          );
          bond.position.set(
            (Math.cos(a) + Math.cos(nextA)) * 0.5 * r,
            (Math.sin(a) + Math.sin(nextA)) * 0.5 * r,
            0
          );
          bond.rotation.z = a + Math.PI / 6;
          molGroup.add(bond);
        }
        parent.add(molGroup);
        this.animatedObjects.push((t) => {
          molGroup.rotation.z = t * 0.6;
          molGroup.rotation.y = Math.sin(t * 0.5) * 0.4;
        });
        break;
      }

      case 'incubator': {
        // #3 細胞培養實用數據：CO2 恆溫培養箱＋粉紅培養液 T-75 培養瓶與多孔盤
        const incubator = new THREE.Mesh(
          new THREE.BoxGeometry(3.4, 4.6, 3.0),
          new THREE.MeshStandardMaterial({ color: 0xecf0f1, roughness: 0.4 })
        );
        incubator.position.set(-1.3, 2.3, -0.4);
        const glassDoor = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 3.2, 0.18),
          this.sharedWindowMat
        );
        glassDoor.position.set(-1.3, 2.1, 1.05);
        const ledPanel = new THREE.Mesh(
          new THREE.BoxGeometry(2.6, 0.55, 0.2),
          new THREE.MeshStandardMaterial({ color: 0x16a085, emissive: 0x1abc9c, emissiveIntensity: 0.4 })
        );
        ledPanel.position.set(-1.3, 4.1, 1.05);
        parent.add(incubator, glassDoor, ledPanel);

        // Pink Phenol-Red T-75 Culture Flask & Petri Dish
        const flask = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 0.9, 3.0),
          new THREE.MeshStandardMaterial({ color: 0xf78fb3, roughness: 0.25 })
        );
        flask.position.set(2.0, 0.8, 0.8);
        flask.rotation.z = 0.15;
        const flaskCap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.45, 0.45, 0.65, 10),
          new THREE.MeshStandardMaterial({ color: 0xd9792f })
        );
        flaskCap.rotation.x = Math.PI / 2;
        flaskCap.position.set(2.0, 1.0, 2.4);
        parent.add(flask, flaskCap);
        break;
      }

      case 'palette': {
        // #4 學術科研配色：三原色稜鏡天文台＋色票長條柱
        const prism = new THREE.Mesh(
          new THREE.ConeGeometry(2.1, 3.8, 3),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.1 })
        );
        prism.position.set(-1.6, 1.9, -0.4);
        parent.add(prism);

        const chartColors = [0x264653, 0x2a9d8f, 0xe9c46a, 0xf4a261, 0xe76f51];
        chartColors.forEach((col, idx) => {
          const h = 1.4 + idx * 0.72;
          const bar = new THREE.Mesh(
            new THREE.BoxGeometry(0.72, h, 0.72),
            new THREE.MeshStandardMaterial({ color: col, roughness: 0.35 })
          );
          bar.position.set(0.5 + idx * 0.88, h / 2, 0.9 - idx * 0.25);
          parent.add(bar);
        });
        break;
      }

      case 'classicGel': {
        // #5 經典SDS-PAGE 鑄膠計算：雙層玻璃片（上膠 pH6.8＋下膠 pH8.8）與綠色電泳梳
        const tankBase = new THREE.Mesh(
          new THREE.BoxGeometry(4.8, 1.2, 3.2),
          new THREE.MeshStandardMaterial({ color: 0xdadfe1, roughness: 0.5 })
        );
        tankBase.position.set(0, 0.6, 0);
        parent.add(tankBase);

        // Resolving Gel (Bottom 4X pH 8.8)
        const resolvingGel = new THREE.Mesh(
          new THREE.BoxGeometry(3.8, 2.6, 0.65),
          new THREE.MeshStandardMaterial({ color: 0xa3e4d7, transparent: true, opacity: 0.85, roughness: 0.2 })
        );
        resolvingGel.position.set(0, 2.5, 0);
        parent.add(resolvingGel);

        // Stacking Gel (Top 4X pH 6.8)
        const stackingGel = new THREE.Mesh(
          new THREE.BoxGeometry(3.8, 1.1, 0.65),
          new THREE.MeshStandardMaterial({ color: 0x5dade2, transparent: true, opacity: 0.9, roughness: 0.2 })
        );
        stackingGel.position.set(0, 4.35, 0);
        parent.add(stackingGel);

        // Green Well Comb on Top
        for (let i = -1.5; i <= 1.5; i += 0.6) {
          const tooth = new THREE.Mesh(
            new THREE.BoxGeometry(0.32, 0.75, 0.72),
            new THREE.MeshStandardMaterial({ color: 0x27ae60 })
          );
          tooth.position.set(i, 5.1, 0);
          parent.add(tooth);
        }
        break;
      }

      case 'tgxGel': {
        // #6 Bio-Rad TGX 鑄膠計算：綠色系快速鑄膠站＋黃金閃電計時地標
        const station = new THREE.Mesh(
          new THREE.BoxGeometry(3.8, 3.6, 2.8),
          new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.4 })
        );
        station.position.set(-0.8, 1.8, 0);
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(2.6, 1.8, 0.2),
          this.sharedWindowMat
        );
        win.position.set(-0.8, 2.0, 1.38);
        parent.add(station, win);

        // Golden Fast-Cast Bolt Monument
        const boltGroup = new THREE.Group();
        boltGroup.position.set(2.2, 3.2, 0.5);
        const boltMat = new THREE.MeshStandardMaterial({
          color: 0xf1c40f,
          emissive: 0xd9792f,
          emissiveIntensity: 0.35,
          roughness: 0.25
        });
        const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 0.5), boltMat);
        b1.rotation.z = -0.35;
        b1.position.y = 0.7;
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 0.5), boltMat);
        b2.rotation.z = -0.35;
        b2.position.set(0.3, -0.6, 0);
        boltGroup.add(b1, b2);
        parent.add(boltGroup);
        this.animatedObjects.push((t) => {
          boltGroup.position.y = 3.2 + Math.sin(t * 3) * 0.2;
        });
        break;
      }

      case 'tgoneGel': {
        // #7 TGOne 鑄膠計算：雙倍速 2X 緩衝液雙儲槽塔＋連通管路
        const tankGeo = new THREE.CylinderGeometry(1.25, 1.25, 4.2, 14);
        const tankMat1 = new THREE.MeshStandardMaterial({ color: 0x00a8cc, roughness: 0.35 });
        const tankMat2 = new THREE.MeshStandardMaterial({ color: 0x2f7a6b, roughness: 0.35 });

        const tankA = new THREE.Mesh(tankGeo, tankMat1);
        tankA.position.set(-1.6, 2.1, 0);
        const tankB = new THREE.Mesh(tankGeo, tankMat2);
        tankB.position.set(1.6, 2.1, 0);

        const pipe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.28, 0.28, 3.2, 10),
          new THREE.MeshStandardMaterial({ color: 0xf39c12 })
        );
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(0, 3.5, 0);

        const glowCore = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 1.8, 1.8),
          this.sharedWindowMat
        );
        glowCore.position.set(0, 1.2, 1.2);

        parent.add(tankA, tankB, pipe, glowCore);
        break;
      }

      case 'bcaWorking': {
        // #8 BCA Working Solution 計算：A/B 試劑雙儲槽＋紫綠色漸層錐形瓶
        const flaskCone = new THREE.Mesh(
          new THREE.ConeGeometry(2.1, 3.2, 16),
          new THREE.MeshStandardMaterial({ color: 0x8e44ad, roughness: 0.3 })
        );
        flaskCone.position.set(0.8, 1.6, 0.4);
        const flaskNeck = new THREE.Mesh(
          new THREE.CylinderGeometry(0.65, 0.65, 1.6, 14),
          new THREE.MeshStandardMaterial({ color: 0xd7bde2, roughness: 0.2 })
        );
        flaskNeck.position.set(0.8, 3.6, 0.4);

        const reagentA = new THREE.Mesh(
          new THREE.CylinderGeometry(0.95, 0.95, 3.6, 12),
          new THREE.MeshStandardMaterial({ color: 0x2980b9 })
        );
        reagentA.position.set(-2.0, 1.8, -0.5);

        const reagentB = new THREE.Mesh(
          new THREE.CylinderGeometry(0.55, 0.55, 2.0, 12),
          new THREE.MeshStandardMaterial({ color: 0x27ae60 })
        );
        reagentB.position.set(-2.0, 1.0, 1.3);

        parent.add(flaskCone, flaskNeck, reagentA, reagentB);
        break;
      }

      case 'proteinAssay': {
        // #9 Bradford/BCA 蛋白質定量：分光比色皿觀測站＋藍色／紫色檢量線階梯
        const cColors = [0x85c1e9, 0x3498db, 0x2874a6, 0x7d3c98, 0x512e5f];
        cColors.forEach((c, idx) => {
          const h = 1.2 + idx * 0.78;
          const cuvette = new THREE.Mesh(
            new THREE.BoxGeometry(0.82, h, 0.82),
            new THREE.MeshStandardMaterial({ color: c, roughness: 0.25 })
          );
          cuvette.position.set(-2.0 + idx * 1.0, h / 2, 0);
          parent.add(cuvette);
        });

        const laserBar = new THREE.Mesh(
          new THREE.BoxGeometry(4.8, 0.22, 0.22),
          new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xd9792f, emissiveIntensity: 0.6 })
        );
        laserBar.position.set(0, 2.8, 0.9);
        laserBar.rotation.z = 0.52;
        parent.add(laserBar);
        break;
      }

      case 'wbNormal': {
        // #10 Western Blot 條帶標準化：黑色轉漬膜顯影暗房＋發光蛋白質條帶紀念碑
        const membrane = new THREE.Mesh(
          new THREE.BoxGeometry(4.6, 4.2, 0.9),
          new THREE.MeshStandardMaterial({ color: 0x1c2833, roughness: 0.5 })
        );
        membrane.position.set(0, 2.1, 0);
        parent.add(membrane);

        // Glowing Target Bands (varying intensities) & Internal Control Bands (uniform)
        const bandMat = new THREE.MeshStandardMaterial({
          color: 0x76ffef,
          emissive: 0x2fd9c4,
          emissiveIntensity: 0.65
        });
        const targetHeights = [0.22, 0.42, 0.68, 0.52];
        for (let i = 0; i < 4; i++) {
          const x = -1.5 + i * 1.0;
          // Target band (top row)
          const tBand = new THREE.Mesh(
            new THREE.BoxGeometry(0.68, targetHeights[i], 0.2),
            bandMat
          );
          tBand.position.set(x, 3.1, 0.5);
          // Housekeeping GAPDH/Actin band (bottom row - uniform)
          const cBand = new THREE.Mesh(
            new THREE.BoxGeometry(0.68, 0.36, 0.2),
            this.sharedWindowMat
          );
          cBand.position.set(x, 1.4, 0.5);
          parent.add(tBand, cBand);
        }
        break;
      }

      case 'elisa': {
        // #11 ELISA 數據分析：96 孔盤黃金矩陣廣場＋S 型擬合曲線拱門
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(4.6, 0.7, 3.2),
          new THREE.MeshStandardMaterial({ color: 0xfdfefe, roughness: 0.4 })
        );
        plate.position.set(0, 0.35, 0.4);
        parent.add(plate);

        const wellColors = [0xf9e79f, 0xf4d03f, 0xf39c12, 0xd68910, 0x5dade2];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 4; c++) {
            const well = new THREE.Mesh(
              new THREE.CylinderGeometry(0.32, 0.32, 0.35, 10),
              new THREE.MeshStandardMaterial({ color: wellColors[(r + c) % wellColors.length] })
            );
            well.position.set(-1.5 + c * 1.0, 0.75, -0.4 + r * 0.85);
            parent.add(well);
          }
        }

        // S-Curve Arch behind the 96-well plate
        const arch = new THREE.Mesh(
          new THREE.TorusGeometry(2.1, 0.22, 10, 24, Math.PI),
          new THREE.MeshStandardMaterial({ color: 0xd9792f, emissive: 0xb85d19, emissiveIntensity: 0.3 })
        );
        arch.position.set(0, 1.0, -1.1);
        parent.add(arch);
        break;
      }

      default:
        break;
    }
  }

  addTreesAndLamps(parent, radius, treeCount) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4b3a, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d5b, roughness: 0.8 });

    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + 0.6;
      const dist = radius * 0.68;
      const tree = new THREE.Group();
      tree.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.9, 6), trunkMat);
      trunk.position.y = 0.45;
      const crown1 = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.5, 7), leafMat);
      crown1.position.y = 1.35;
      const crown2 = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.2, 7), leafMat);
      crown2.position.y = 2.05;

      tree.add(trunk, crown1, crown2);
      parent.add(tree);
    }

    // Street Lamp
    const lampGroup = new THREE.Group();
    lampGroup.position.set(radius * 0.55, 0, radius * 0.45);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 1.9, 6),
      new THREE.MeshStandardMaterial({ color: 0x34495e })
    );
    pole.position.y = 0.95;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      this.sharedWindowMat
    );
    bulb.position.y = 1.95;
    lampGroup.add(pole, bulb);
    parent.add(lampGroup);
  }

  buildBridgesAndPaths() {
    this.bridgeSegments = [];
    const centerPos = new THREE.Vector3(0, 0.9, 0);

    // Connect center island to the first island of each category, and chain within categories
    const chains = [
      ['center-island', 'island-01', 'island-02', 'island-03', 'island-04'],
      ['center-island', 'island-05', 'island-06', 'island-07'],
      ['center-island', 'island-08', 'island-09', 'island-10', 'island-11']
    ];

    const deckMat = new THREE.MeshStandardMaterial({ color: 0xc89f72, roughness: 0.85 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x7f5539, roughness: 0.9 });

    chains.forEach((chain) => {
      for (let i = 0; i < chain.length - 1; i++) {
        const nodeA = this.islandNodes.get(chain[i]);
        const nodeB = this.islandNodes.get(chain[i + 1]);
        if (!nodeA || !nodeB) continue;

        const pA = new THREE.Vector3(nodeA.data.position.x, 0.8, nodeA.data.position.z);
        const pB = new THREE.Vector3(nodeB.data.position.x, 0.8, nodeB.data.position.z);

        const dir = new THREE.Vector3().subVectors(pB, pA);
        const fullDist = dir.length();
        dir.normalize();

        const rA = nodeA.data.isCenter ? 11.2 : 6.4;
        const rB = nodeB.data.isCenter ? 11.2 : 6.4;

        const start = pA.clone().addScaledVector(dir, rA);
        const end = pB.clone().addScaledVector(dir, -rB);
        const span = start.distanceTo(end);

        if (span > 1) {
          const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
          const bridge = new THREE.Group();
          bridge.position.copy(mid);
          bridge.lookAt(end);

          const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, span), deckMat);
          deck.receiveShadow = true;
          bridge.add(deck);

          const postCount = Math.max(2, Math.floor(span / 5));
          for (let p = 0; p <= postCount; p++) {
            const z = -span / 2 + (p / postCount) * span;
            const pL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.16), postMat);
            pL.position.set(-0.68, 0.3, z);
            const pR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.16), postMat);
            pR.position.set(0.68, 0.3, z);
            bridge.add(pL, pR);
          }

          this.scene.add(bridge);
          this.bridgeSegments.push({ start, end });
        }
      }
    });
  }

  buildWalkers() {
    // Low-poly lab coat people walking along bridges and central plaza
    const isMobile = window.innerWidth <= 768;
    const segments = this.bridgeSegments;
    const walkerCount = isMobile ? Math.min(5, segments.length) : segments.length;

    const coatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffdfc4, roughness: 0.6 });
    const hairColors = [0x2c3e50, 0x6e4b3a, 0xd9792f, 0x2f7a6b];

    for (let i = 0; i < walkerCount; i++) {
      const seg = segments[i % segments.length];
      const person = new THREE.Group();

      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.75, 8), coatMat);
      body.position.y = 0.38;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), headMat);
      head.position.y = 0.92;
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.23, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
        new THREE.MeshStandardMaterial({ color: hairColors[i % hairColors.length] })
      );
      cap.position.y = 0.95;

      person.add(body, head, cap);
      this.scene.add(person);

      this.walkers.push({
        mesh: person,
        start: seg.start.clone(),
        end: seg.end.clone(),
        progress: (i * 0.27) % 1,
        dir: i % 2 === 0 ? 1 : -1,
        speed: 0.08 + (i % 3) * 0.025
      });
    }
  }

  setTheme(themeId) {
    this.currentTheme = themeId;
    this.applyThemeColors(themeId);
  }

  applyThemeColors(themeId) {
    if (!this.scene) return;
    let skyHex = 0xf6f0e4;
    let seaHex = 0x6dc0b8;
    if (themeId === 'mist') {
      skyHex = 0xdcebee;
      seaHex = 0x5aa6b8;
    } else if (themeId === 'night') {
      skyHex = 0x16222e;
      seaHex = 0x1d3b4f;
    }
    this.scene.background.setHex(skyHex);
    this.scene.fog.color.setHex(skyHex);
    if (this.seaMat) {
      this.seaMat.color.setHex(seaHex);
    }
  }

  setLightMode(mode) {
    this.currentLightMode = mode;
    this.applyLightMode(mode);
  }

  applyLightMode(mode) {
    if (!this.dirLight) return;
    if (mode === 'day') {
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 0.78;
      this.hemiLight.color.setHex(0xffffff);
      this.hemiLight.groundColor.setHex(0xd8cfc0);
      this.hemiLight.intensity = 0.65;
      this.dirLight.color.setHex(0xfff8eb);
      this.dirLight.intensity = 1.35;
      this.dirLight.position.set(45, 75, 40);
      this.windowMaterials.forEach((m) => {
        m.emissiveIntensity = 0.1;
      });
    } else if (mode === 'dusk') {
      this.ambientLight.color.setHex(0xffd6b8);
      this.ambientLight.intensity = 0.62;
      this.hemiLight.color.setHex(0xff9e6d);
      this.hemiLight.groundColor.setHex(0x4b3b47);
      this.hemiLight.intensity = 0.55;
      this.dirLight.color.setHex(0xff8c42);
      this.dirLight.intensity = 1.25;
      this.dirLight.position.set(-65, 34, 35);
      this.windowMaterials.forEach((m) => {
        m.emissiveIntensity = 0.65;
      });
    } else {
      // night
      this.ambientLight.color.setHex(0x6b8cae);
      this.ambientLight.intensity = 0.42;
      this.hemiLight.color.setHex(0x3a5a78);
      this.hemiLight.groundColor.setHex(0x121e2b);
      this.hemiLight.intensity = 0.45;
      this.dirLight.color.setHex(0x9ec5fe);
      this.dirLight.intensity = 0.72;
      this.dirLight.position.set(-30, 65, -40);
      this.windowMaterials.forEach((m) => {
        m.emissiveIntensity = 1.2;
      });
    }
  }

  setReducedMotion(flag) {
    this.reducedMotion = Boolean(flag);
  }

  updateVisitedBadges(visitedSet) {
    this.visitedSet = visitedSet;
    this.islandNodes.forEach((node) => {
      const isVisited = visitedSet.has(node.id);
      node.visitedSpan.textContent = isVisited ? '✓' : '';
      node.visitedSpan.title = isVisited ? '已逛過此島' : '';
    });
  }

  setSearchFilter(query) {
    this.searchQuery = (query || '').trim().toLowerCase();
    let matchCount = 0;
    this.islandNodes.forEach((node) => {
      if (!this.searchQuery) {
        node.labelEl.style.opacity = '1';
        node.labelEl.style.filter = 'none';
        return;
      }
      const hay = [
        node.data.name,
        node.data.group,
        node.data.intro,
        node.data.extra,
        ...(node.data.points || [])
      ]
        .join(' ')
        .toLowerCase();
      const matched = hay.includes(this.searchQuery);
      if (matched) matchCount++;
      node.labelEl.style.opacity = matched ? '1' : '0.25';
      node.labelEl.style.filter = matched ? 'none' : 'grayscale(0.8)';
    });
    return matchCount;
  }

  focusIsland(islandId) {
    this.selectedIslandId = islandId;
    this.islandNodes.forEach((node, id) => {
      node.labelEl.classList.toggle('is-active', id === islandId);
    });

    const node = this.islandNodes.get(islandId);
    if (!node) return;

    const targetPos = new THREE.Vector3(node.data.position.x, 2.5, node.data.position.z);
    const dist = node.data.isCenter ? 32 : 24;
    const radial = new THREE.Vector3(node.data.position.x, 0, node.data.position.z);
    if (radial.lengthSq() < 1) {
      radial.set(0, 0, 1);
    } else {
      radial.normalize();
    }
    const camEnd = new THREE.Vector3(
      node.data.position.x + radial.x * dist * 0.75,
      node.data.isCenter ? 22 : 16,
      node.data.position.z + radial.z * dist * 0.75 + 10
    );

    this.flyTo(camEnd, targetPos);
  }

  resetOverview() {
    this.selectedIslandId = null;
    this.islandNodes.forEach((node) => {
      node.labelEl.classList.remove('is-active');
    });
    this.flyTo(this.defaultCameraPos, this.defaultTarget);
  }

  flyTo(targetCamPos, targetLookAt) {
    if (this.reducedMotion) {
      this.camera.position.copy(targetCamPos);
      this.controls.target.copy(targetLookAt);
      this.controls.update();
      this.cameraTween = null;
      return;
    }
    this.cameraTween = {
      startCam: this.camera.position.clone(),
      endCam: targetCamPos.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: targetLookAt.clone(),
      elapsed: 0,
      duration: 0.75
    };
  }

  bindEvents() {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos.set(e.clientX, e.clientY);
    });

    dom.addEventListener('pointerup', (e) => {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return; // Dragged, not clicked

      const rect = dom.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      this.raycaster.setFromCamera(mouse, this.camera);
      const allHitMeshes = [];
      this.islandNodes.forEach((n) => allHitMeshes.push(...n.hitMeshes));

      const intersects = this.raycaster.intersectObjects(allHitMeshes, false);
      if (intersects.length > 0) {
        const hitId = intersects[0].object.userData.islandId;
        if (hitId) {
          this.onSelectIsland(hitId);
        }
      }
    });

    window.addEventListener('resize', () => this.handleResize());
  }

  handleResize() {
    if (!this.renderer || !this.camera) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    // Adjust default camera distance on narrow mobile viewports so all islands fit comfortably
    const isNarrow = width < 600;
    this.defaultCameraPos.set(0, isNarrow ? 92 : 68, isNarrow ? 148 : 108);
    this.defaultTarget.set(0, 0, isNarrow ? -6 : 4);
    if (!this.selectedIslandId && !this.cameraTween) {
      this.camera.position.copy(this.defaultCameraPos);
      this.controls.target.copy(this.defaultTarget);
      this.controls.update();
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  updateLabelsNonOverlapping() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const isMobile = width <= 768;

    const statusEl = document.querySelector('.status-bar');
    const toastEl = document.getElementById('grandpa-toast');
    const panelEl = document.getElementById('detail-panel');
    const statusBottom = statusEl ? statusEl.getBoundingClientRect().bottom : 120;
    const toastVisible = toastEl && !toastEl.classList.contains('is-hidden');
    const toastTop = toastVisible ? toastEl.getBoundingClientRect().top : height;
    const panelOpen = panelEl && panelEl.classList.contains('is-open');

    const items = [];
    const tempV = new THREE.Vector3();

    this.islandNodes.forEach((node) => {
      tempV.copy(node.anchor);
      tempV.project(this.camera);

      // Behind camera check
      if (tempV.z > 1) {
        node.labelEl.style.display = 'none';
        node.lineEl.style.opacity = '0';
        node.dotEl.style.opacity = '0';
        return;
      }

      node.labelEl.style.display = 'inline-flex';
      const anchorX = (tempV.x * 0.5 + 0.5) * width;
      const anchorY = (-tempV.y * 0.5 + 0.5) * height;

      const w = node.labelEl.offsetWidth || (isMobile ? 110 : 155);
      const h = node.labelEl.offsetHeight || (isMobile ? 26 : 36);

      items.push({
        node,
        anchorX,
        anchorY,
        x: anchorX,
        y: anchorY - 8,
        w: w + 6,
        h: h + 5,
        depth: tempV.z
      });
    });

    // Iterative Collision Repulsion Solver to prevent ANY label overlap
    const minTop = Math.max(60, statusBottom + 8);
    const maxBottom = isMobile && panelOpen
      ? Math.min(height * 0.34, toastTop - 8)
      : Math.min(height - 14, toastTop - 8);
    const minLeft = 6;
    const maxRight = !isMobile && panelOpen ? Math.max(320, width - 444) : width - 6;

    for (let iter = 0; iter < 18; iter++) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minW = (a.w + b.w) * 0.5;
          const minH = (a.h + b.h) * 0.5;

          const overlapX = minW - Math.abs(dx);
          const overlapY = minH - Math.abs(dy);

          if (overlapX > 0 && overlapY > 0) {
            if (overlapY < overlapX * 1.5) {
              const signY = dy > 0 ? 1 : dy < 0 ? -1 : i % 2 === 0 ? 1 : -1;
              const pushY = (overlapY * 0.58 + 1) * signY;
              a.y -= pushY;
              b.y += pushY;
              const signX = dx >= 0 ? 1 : -1;
              a.x -= signX * 2;
              b.x += signX * 2;
            } else {
              const signX = dx > 0 ? 1 : dx < 0 ? -1 : i % 2 === 0 ? 1 : -1;
              const pushX = (overlapX * 0.58 + 1) * signX;
              a.x -= pushX;
              b.x += pushX;
            }
          }
        }
      }

      // Clamp inside safe screen bounds (below status-bar, above grandpa-toast)
      items.forEach((it) => {
        const halfW = it.w * 0.5;
        const halfH = it.h * 0.5;
        it.x = Math.max(minLeft + halfW, Math.min(maxRight - halfW, it.x));
        if (maxBottom > minTop + it.h) {
          it.y = Math.max(minTop + halfH, Math.min(maxBottom - halfH, it.y));
        }
      });
    }

    // Apply resolved coordinates & update SVG leader lines
    items.forEach((it) => {
      it.node.labelEl.style.left = `${it.x.toFixed(1)}px`;
      it.node.labelEl.style.top = `${it.y.toFixed(1)}px`;
      const zIdx = it.node.id === this.selectedIslandId ? 30 : Math.round((1 - it.depth) * 20);
      it.node.labelEl.style.zIndex = String(zIdx);

      const dist = Math.hypot(it.x - it.anchorX, it.y - it.anchorY);
      if (dist > 14) {
        it.node.lineEl.setAttribute('x1', it.anchorX.toFixed(1));
        it.node.lineEl.setAttribute('y1', it.anchorY.toFixed(1));
        it.node.lineEl.setAttribute('x2', it.x.toFixed(1));
        it.node.lineEl.setAttribute('y2', it.y.toFixed(1));
        it.node.lineEl.style.opacity = '0.75';

        it.node.dotEl.setAttribute('cx', it.anchorX.toFixed(1));
        it.node.dotEl.setAttribute('cy', it.anchorY.toFixed(1));
        it.node.dotEl.style.opacity = '0.9';
      } else {
        it.node.lineEl.style.opacity = '0';
        it.node.dotEl.style.opacity = '0';
      }
    });
  }

  animate() {
    this.rafId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    if (this.cameraTween) {
      this.cameraTween.elapsed += dt;
      const t = Math.min(1, this.cameraTween.elapsed / this.cameraTween.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.cameraTween.startCam, this.cameraTween.endCam, ease);
      this.controls.target.lerpVectors(this.cameraTween.startTarget, this.cameraTween.endTarget, ease);
      if (t >= 1) this.cameraTween = null;
    }

    this.controls.update();

    if (!this.reducedMotion) {
      // Animate landmarks
      this.animatedObjects.forEach((fn) => fn(elapsed));

      // Subtle sea ripple animation
      if (this.ripplesGroup) {
        const s = 1 + Math.sin(elapsed * 1.6) * 0.03;
        this.ripplesGroup.scale.set(s, 1, s);
      }

      // Update walking lab people along bridges
      this.walkers.forEach((w) => {
        w.progress += w.dir * w.speed * dt;
        if (w.progress >= 1) {
          w.progress = 1;
          w.dir = -1;
        } else if (w.progress <= 0) {
          w.progress = 0;
          w.dir = 1;
        }
        w.mesh.position.lerpVectors(w.start, w.end, w.progress);
        w.mesh.position.y = 0.92 + Math.abs(Math.sin(elapsed * 7 + w.progress * 12)) * 0.08;
        w.mesh.lookAt(w.dir > 0 ? w.end : w.start);
      });
    } else {
      // Static positions when reducedMotion is enabled
      this.walkers.forEach((w) => {
        w.mesh.position.lerpVectors(w.start, w.end, w.progress);
        w.mesh.position.y = 0.92;
      });
    }

    this.renderer.render(this.scene, this.camera);
    this.updateLabelsNonOverlapping();
  }
}
