/* Lightweight responsive canvas opening; no third-party renderer or assets. */
(function () {
  const intro = document.querySelector("#cinematicIntro");
  const canvas = document.querySelector("#cinematicCanvas");
  const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let mobile = false;
  const lowPower = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  let particleCount = 0;
  const spokeCount = 20;
  const ringCount = 9;
  const pointsPerRing = 96;
  const particles = [];
  let width = 0;
  let height = 0;
  let ratio = 1;
  let pointerX = 0;
  let pointerY = 0;
  let startedAt = 0;
  let frame = 0;
  let dismissed = false;
  let lastDisplayedProgress = -1;
  const duration = 11200;
  const progressMilestones = [
    { time: 0, value: 0 },
    { time: 2200, value: 25 },
    { time: 4600, value: 50 },
    { time: 7000, value: 75 },
    { time: 9100, value: 100 }
  ];
  const hudProgress = document.querySelector("#hudProgress");
  const hudProgressFill = document.querySelector("#hudProgressFill");
  const hudPercent = document.querySelector("#hudPercent");
  const hudStatus = document.querySelector("#hudStatus");
  const hudSubstatus = document.querySelector("#hudSubstatus");
  const swingShots = [
    { shoot: 520, attach: 790, begin: 840, end: 2830, anchor: [.76, .1], from: [.12, .67], to: [.73, .62], side: 1 },
    { shoot: 2860, attach: 3120, begin: 3180, end: 5180, anchor: [.2, .11], from: [.79, .65], to: [.18, .61], side: -1 },
    { shoot: 5220, attach: 5460, begin: 5520, end: 7820, anchor: [.83, .09], from: [.15, .67], to: [.53, .54], side: 1 }
  ];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smooth = value => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };

  document.documentElement.classList.add("cinema-active");
  document.querySelectorAll("header, main, footer").forEach(element => { element.inert = true; });
  document.querySelector("#cinemaSkip").addEventListener("click", revealEntry);
  intro.addEventListener("keydown", event => {
    if (event.key === "Escape") revealEntry();
  });
  intro.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => {
    if (window.PGCinematicIntro) window.PGCinematicIntro.dismiss();
  }));

  function revealEntry() {
    if (dismissed) return;
    intro.classList.add("is-title", "is-network", "is-online", "is-entry");
    document.querySelector("#cinemaEntry").setAttribute("aria-hidden", "false");
    document.querySelector("#cinemaSkip").textContent = "CONTINUE TO SITE";
    document.querySelector("#cinemaSkip").addEventListener("click", dismiss, { once: true });
    if (frame) cancelAnimationFrame(frame);
    render(performance.now(), true);
    const firstAction = intro.querySelector("[data-go='participant-details']");
    if (firstAction) firstAction.focus({ preventScroll: true });
  }

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (frame) cancelAnimationFrame(frame);
    intro.classList.add("is-leaving");
    intro.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("cinema-active");
    document.querySelectorAll("header, main, footer").forEach(element => { element.inert = false; });
    window.setTimeout(() => { intro.hidden = true; }, 800);
  }
  window.PGCinematicIntro = Object.freeze({ dismiss, revealEntry });

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    mobile = width <= 600 || width / height < .78;
    particleCount = reducedMotion ? 0 : mobile || lowPower ? 38 : 82;
    ratio = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5, width > 2560 ? 1.25 : 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (particles.length > particleCount) particles.length = particleCount;
    for (let i = particles.length; i < particleCount; i++) {
      particles.push({
        x: Math.random(), y: Math.random(), z: .15 + Math.random() * .85,
        size: .4 + Math.random() * 1.5, phase: Math.random() * Math.PI * 2,
        speed: .04 + Math.random() * .12
      });
    }
  }

  function project(angle, radius, time, camera) {
    const wave = Math.sin(angle * 3 + radius * 7 + time * .00024) * .19 +
      Math.cos(angle * 2 - radius * 5) * .09;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = wave * radius;
    const yaw = camera.yaw;
    const pitch = camera.pitch;
    const rolledX = x * Math.cos(yaw) - z * Math.sin(yaw);
    const turnedZ = x * Math.sin(yaw) + z * Math.cos(yaw);
    const turnedY = y * Math.cos(pitch) - turnedZ * Math.sin(pitch);
    const depth = y * Math.sin(pitch) + turnedZ * Math.cos(pitch);
    const perspective = 1.35 / (1.35 + depth * .56);
    const scale = Math.min(width, height) * .73 * camera.zoom * perspective;
    return {
      x: width * .5 + rolledX * scale * (width / height) - camera.trackX * width,
      y: height * .49 + turnedY * scale - camera.trackY * height,
      perspective
    };
  }

  function drawThread(time, progress) {
    const start = progress < .22 ? -0.22 + progress * 2.4 : .31;
    const x = start * width;
    const y = height * (.47 + Math.sin(time * .003) * .06);
    const endX = width * .5;
    const endY = height * .49;
    const fade = 1 - smooth((progress - .07) / .23);
    if (fade <= 0) return;
    context.save();
    context.globalAlpha = fade;
    context.lineWidth = 2.1;
    context.strokeStyle = "#ff5376";
    context.shadowColor = "#2bbdff";
    context.shadowBlur = 18;
    context.beginPath();
    context.moveTo(x, y);
    context.bezierCurveTo(width * .68, y - height * .16, width * .3, endY + height * .1, endX, endY);
    context.stroke();
    context.restore();
  }

  function cubicPoint(points, progress) {
    const t = clamp(progress, 0, 1);
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * points[0].x + 3 * inverse ** 2 * t * points[1].x +
        3 * inverse * t ** 2 * points[2].x + t ** 3 * points[3].x,
      y: inverse ** 3 * points[0].y + 3 * inverse ** 2 * t * points[1].y +
        3 * inverse * t ** 2 * points[2].y + t ** 3 * points[3].y
    };
  }

  function positionForShot(shot, progress) {
    const direction = shot.to[0] > shot.from[0] ? 1 : -1;
    return cubicPoint([
      { x: shot.from[0], y: shot.from[1] },
      { x: shot.from[0] + direction * .12, y: shot.from[1] - .68 },
      { x: shot.to[0] - direction * .16, y: shot.to[1] - .64 },
      { x: shot.to[0], y: shot.to[1] }
    ], progress);
  }

  function drawCity(time, camera) {
    context.save();
    const baseline = height * (mobile ? .88 : .91);
    const drift = Math.sin(time * .00032 + camera.yaw) * width * (mobile ? .012 : .028) - camera.trackX * width * .24;
    const layers = mobile ? [{ count: 17, base: .08, spread: .21, color: "rgba(5,12,24,.78)", light: .12 }] :
      [{ count: 30, base: .12, spread: .24, color: "rgba(4,10,22,.55)", light: .07 },
        { count: 23, base: .1, spread: .25, color: "rgba(5,13,28,.84)", light: .16 }];
    for (let layer = 0; layer < layers.length; layer++) {
      const skyline = layers[layer];
      const step = width / skyline.count;
      const layerDrift = drift * (layer ? 1 : .45);
      context.fillStyle = skyline.color;
      context.beginPath();
      context.moveTo(-step, height);
      for (let index = -1; index <= skyline.count + 1; index++) {
        const seed = ((index * 37 + 110) % 13 + 13) % 13;
        const buildingWidth = step * (.52 + seed % 4 * .07);
        const top = baseline - height * (skyline.base + seed * skyline.spread / 13);
        const left = index * step + layerDrift;
        context.lineTo(left, top);
        context.lineTo(left + buildingWidth, top);
        context.lineTo(left + buildingWidth, height);
      }
      context.lineTo(width + step, height);
      context.closePath();
      context.fill();
      context.strokeStyle = `rgba(87,174,215,${skyline.light})`;
      context.lineWidth = 1;
      for (let index = 0; index < skyline.count; index++) {
        const seed = ((index * 37 + 110) % 13 + 13) % 13;
        const buildingWidth = step * (.52 + seed % 4 * .07);
        const left = index * step + layerDrift;
        const top = baseline - height * (skyline.base + seed * skyline.spread / 13);
        context.beginPath();
        context.moveTo(left + buildingWidth, top);
        context.lineTo(left + buildingWidth, baseline + height * .08);
        context.stroke();
        for (let row = 0; row < 5; row++) {
          const windowY = top + (row + 1) * Math.max(4, height * .018);
          if (windowY >= baseline) continue;
          context.fillStyle = (index * 5 + row * 3) % 7 < 2
            ? `rgba(96,209,241,${skyline.light * 2.4})`
            : `rgba(255,66,95,${skyline.light * .48})`;
          context.fillRect(left + step * .12, windowY, Math.max(1, buildingWidth * .16), Math.max(1, height * .003));
          context.fillRect(left + buildingWidth * .56, windowY, Math.max(1, buildingWidth * .16), Math.max(1, height * .003));
        }
      }
    }
    if (!mobile && time > 3600) {
      const depth = smooth((time - 3600) / 2200);
      context.save();
      context.globalAlpha = depth * .24;
      context.strokeStyle = "#75d8ff";
      for (let side = 0; side < 2; side++) {
        const x = side ? width : 0;
        context.lineWidth = width * .025;
        context.beginPath();
        context.moveTo(x, height * .34);
        context.lineTo(side ? width * .91 : width * .09, height);
        context.stroke();
        context.lineWidth = 1;
        for (let floor = 0; floor < 8; floor++) {
          const y = height * (.42 + floor * .075);
          context.beginPath();
          context.moveTo(side ? width * (.91 + floor * .011) : width * (.09 - floor * .011), y);
          context.lineTo(x, y + height * .015);
          context.stroke();
        }
      }
      context.restore();
    }
    context.restore();
  }

  function drawAnchor(x, y, pulse, network) {
    const radius = 4 + pulse * 8;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = .25 + pulse * .6;
    context.strokeStyle = network > .5 ? "#65eaff" : "#ff587a";
    context.shadowColor = context.strokeStyle;
    context.shadowBlur = 15;
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(x - radius - 5, y); context.lineTo(x + radius + 5, y);
    context.moveTo(x, y - radius - 5); context.lineTo(x, y + radius + 5);
    context.stroke();
    context.restore();
  }

  function drawSilhouette(x, y, scale, angle, pose, alpha) {
    const unit = Math.min(width, height) * scale;
    const detailed = alpha > .2;
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.scale(unit, unit);
    context.globalAlpha = alpha;
    context.lineCap = "round";
    context.lineJoin = "round";
    const redSuit = context.createLinearGradient(-.25, -.42, .23, .26);
    redSuit.addColorStop(0, "#ff5363");
    redSuit.addColorStop(.2, "#a9142c");
    redSuit.addColorStop(.46, "#4e0a1a");
    redSuit.addColorStop(.72, "#bd1b31");
    redSuit.addColorStop(1, "#310815");
    const blueSuit = context.createLinearGradient(-.22, -.25, .24, .48);
    blueSuit.addColorStop(0, "#37a2d5");
    blueSuit.addColorStop(.18, "#17476e");
    blueSuit.addColorStop(.52, "#07182c");
    blueSuit.addColorStop(.78, "#102d4b");
    blueSuit.addColorStop(1, "#030b16");
    const seamBlue = "rgba(119,213,255,.62)";
    const seamRed = "rgba(255,128,139,.6)";

    const linePath = points => {
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      for (let index = 1; index < points.length - 1; index++) {
        const midX = (points[index][0] + points[index + 1][0]) * .5;
        const midY = (points[index][1] + points[index + 1][1]) * .5;
        context.quadraticCurveTo(points[index][0], points[index][1], midX, midY);
      }
      const last = points[points.length - 1];
      context.lineTo(last[0], last[1]);
    };
    const limb = (points, lineWidth, material, seam, highlight) => {
      const radii = [lineWidth * .49, lineWidth * .38, lineWidth * .23];
      const edges = points.map((point, index) => {
        const before = points[Math.max(0, index - 1)];
        const after = points[Math.min(points.length - 1, index + 1)];
        const dx = after[0] - before[0];
        const dy = after[1] - before[1];
        const length = Math.hypot(dx, dy) || 1;
        const normal = [-dy / length, dx / length];
        return [
          [point[0] + normal[0] * radii[index], point[1] + normal[1] * radii[index]],
          [point[0] - normal[0] * radii[index], point[1] - normal[1] * radii[index]]
        ];
      });
      const limbPath = () => {
        context.beginPath();
        context.moveTo(edges[0][0][0], edges[0][0][1]);
        context.quadraticCurveTo(edges[1][0][0], edges[1][0][1], edges[2][0][0], edges[2][0][1]);
        context.lineTo(edges[2][1][0], edges[2][1][1]);
        context.quadraticCurveTo(edges[1][1][0], edges[1][1][1], edges[0][1][0], edges[0][1][1]);
        context.closePath();
      };
      limbPath();
      context.fillStyle = "#020711";
      context.strokeStyle = "rgba(1,4,10,.94)";
      context.lineWidth = detailed ? .014 : .008;
      context.shadowColor = "#02050b";
      context.shadowBlur = detailed ? 8 : 3;
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      limbPath();
      context.fillStyle = material;
      context.fill();
      if (!detailed) return;

      context.save();
      limbPath();
      context.clip();
      const surface = context.createLinearGradient(-lineWidth, 0, lineWidth, 0);
      surface.addColorStop(0, "rgba(0,4,12,.52)");
      surface.addColorStop(.28, highlight);
      surface.addColorStop(.52, "rgba(255,255,255,.1)");
      surface.addColorStop(.8, seam);
      surface.addColorStop(1, "rgba(0,4,12,.55)");
      context.globalAlpha = alpha * .72;
      context.strokeStyle = surface;
      context.lineWidth = lineWidth * .12;
      linePath(points);
      context.stroke();
      context.globalAlpha = alpha * .3;
      context.strokeStyle = seam;
      context.lineWidth = .003;
      for (let stitch = 0; stitch < 5; stitch++) {
        const t = (stitch + 1) / 6;
        const centerX = (1 - t) * (1 - t) * points[0][0] +
          2 * (1 - t) * t * points[1][0] + t * t * points[2][0];
        const centerY = (1 - t) * (1 - t) * points[0][1] +
          2 * (1 - t) * t * points[1][1] + t * t * points[2][1];
        context.beginPath();
        context.moveTo(centerX - lineWidth * .25, centerY);
        context.quadraticCurveTo(centerX, centerY + lineWidth * .06, centerX + lineWidth * .25, centerY);
        context.stroke();
      }
      context.restore();
      context.globalAlpha = alpha;
      context.strokeStyle = seam;
      context.lineWidth = .004;
      context.beginPath();
      context.moveTo(edges[1][0][0], edges[1][0][1]);
      context.quadraticCurveTo(points[1][0], points[1][1], edges[1][1][0], edges[1][1][1]);
      context.stroke();
    };
    const fillPanel = (path, material, stroke, lineWidth) => {
      context.beginPath();
      path();
      context.fillStyle = material;
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth;
      context.shadowColor = "#020711";
      context.shadowBlur = detailed ? 8 : 3;
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
    };

    limb(pose.backArm, .105, redSuit, seamRed, "rgba(255,174,165,.65)");
    limb(pose.backLeg, .125, blueSuit, seamBlue, "rgba(158,223,255,.55)");
    limb(pose.freeLeg, .12, blueSuit, seamBlue, "rgba(158,223,255,.55)");
    limb(pose.webArm, .1, redSuit, seamRed, "rgba(255,174,165,.65)");

    const torso = () => {
      context.beginPath();
      context.moveTo(-.067, -.29);
      context.quadraticCurveTo(-.115, -.27, -.159, -.221);
      context.quadraticCurveTo(-.179, -.19, -.158, -.127);
      context.lineTo(-.124, .115);
      context.quadraticCurveTo(-.102, .205, -.069, .239);
      context.quadraticCurveTo(0, .267, .069, .239);
      context.quadraticCurveTo(.102, .205, .124, .115);
      context.lineTo(.158, -.127);
      context.quadraticCurveTo(.179, -.19, .159, -.221);
      context.quadraticCurveTo(.115, -.27, .067, -.29);
      context.closePath();
    };
    fillPanel(torso, blueSuit, "rgba(101,191,229,.55)", .01);

    context.save();
    context.beginPath();
    torso();
    context.clip();
    context.fillStyle = redSuit;
    context.beginPath();
    context.moveTo(-.164, -.216);
    context.quadraticCurveTo(-.075, -.315, 0, -.24);
    context.quadraticCurveTo(.075, -.315, .164, -.216);
    context.lineTo(.118, -.034);
    context.quadraticCurveTo(.06, .004, 0, -.009);
    context.quadraticCurveTo(-.06, .004, -.118, -.034);
    context.closePath();
    context.fill();
    if (detailed) {
      context.globalAlpha = alpha * .44;
      context.strokeStyle = "rgba(255,177,163,.76)";
      context.lineWidth = .0035;
      for (let row = 0; row < 7; row++) {
        const yLine = -.251 + row * .031;
        const span = .058 + row * .013;
        context.beginPath();
        context.moveTo(-span, yLine);
        context.quadraticCurveTo(0, yLine + .012, span, yLine);
        context.stroke();
      }
      for (let ray = -5; ray <= 5; ray++) {
        context.beginPath();
        context.moveTo(0, -.247);
        context.quadraticCurveTo(ray * .018, -.14, ray * .03, -.025);
        context.stroke();
      }
      context.globalAlpha = alpha * .18;
      context.strokeStyle = "rgba(255,210,201,.9)";
      context.lineWidth = .0018;
      for (let row = 0; row < 8; row++) {
        const yLine = -.231 + row * .027;
        for (let column = -3; column <= 3; column++) {
          const xLine = column * .019 + (row % 2) * .0095;
          context.beginPath();
          context.moveTo(xLine - .007, yLine - .004);
          context.lineTo(xLine + .007, yLine + .004);
          context.stroke();
        }
      }
      context.globalAlpha = alpha * .52;
      context.strokeStyle = "rgba(10,25,43,.9)";
      context.lineWidth = .008;
      context.beginPath();
      context.moveTo(-.116, -.015); context.quadraticCurveTo(-.055, .023, -.057, .105);
      context.moveTo(.116, -.015); context.quadraticCurveTo(.055, .023, .057, .105);
      context.stroke();
      context.globalAlpha = alpha * .55;
      context.strokeStyle = "rgba(141,218,245,.58)";
      context.lineWidth = .003;
      context.beginPath();
      context.moveTo(-.1, -.175); context.quadraticCurveTo(-.074, -.15, -.082, -.12);
      context.moveTo(.1, -.175); context.quadraticCurveTo(.074, -.15, .082, -.12);
      context.moveTo(-.078, .166); context.quadraticCurveTo(-.04, .198, -.018, .203);
      context.moveTo(.078, .166); context.quadraticCurveTo(.04, .198, .018, .203);
      context.stroke();
    }
    context.restore();
    context.globalAlpha = alpha;

    fillPanel(() => {
      context.moveTo(-.071, -.287);
      context.quadraticCurveTo(-.107, -.36, -.083, -.441);
      context.quadraticCurveTo(-.055, -.521, 0, -.528);
      context.quadraticCurveTo(.055, -.521, .083, -.441);
      context.quadraticCurveTo(.107, -.36, .071, -.287);
      context.quadraticCurveTo(0, -.257, -.071, -.287);
      context.closePath();
    }, redSuit, "rgba(255,132,139,.75)", .009);

    if (detailed) {
      context.save();
      context.beginPath();
      context.moveTo(-.077, -.44);
      context.quadraticCurveTo(0, -.475, .077, -.44);
      context.quadraticCurveTo(.055, -.36, 0, -.344);
      context.quadraticCurveTo(-.055, -.36, -.077, -.44);
      context.clip();
      const lens = side => {
        context.beginPath();
        context.moveTo(side * .008, -.425);
        context.quadraticCurveTo(side * .034, -.455, side * .071, -.433);
        context.quadraticCurveTo(side * .057, -.391, side * .021, -.388);
        context.closePath();
        const reflection = context.createLinearGradient(0, -.455, 0, -.384);
        reflection.addColorStop(0, "#ffffff");
        reflection.addColorStop(.32, "#d8f7ff");
        reflection.addColorStop(.75, "#94b9c9");
        reflection.addColorStop(1, "#395d70");
        context.fillStyle = reflection;
        context.shadowColor = "#a7f1ff";
        context.shadowBlur = 5;
        context.fill();
        context.shadowBlur = 0;
        context.strokeStyle = "rgba(255,255,255,.92)";
        context.lineWidth = .004;
        context.stroke();
        context.strokeStyle = "rgba(13,31,47,.82)";
        context.lineWidth = .002;
        context.stroke();
      };
      lens(-1);
      lens(1);
      context.restore();
      context.globalAlpha = alpha * .55;
      context.strokeStyle = "rgba(255,190,180,.72)";
      context.lineWidth = .003;
      context.beginPath();
      context.moveTo(-.044, -.47); context.quadraticCurveTo(0, -.43, .044, -.47);
      context.moveTo(-.067, -.392); context.quadraticCurveTo(0, -.349, .067, -.392);
      context.stroke();
      context.globalAlpha = alpha;

      context.save();
      context.globalAlpha = alpha * .4;
      context.strokeStyle = "rgba(255,208,194,.78)";
      context.lineWidth = .0025;
      context.beginPath();
      context.moveTo(-.126, -.189); context.lineTo(-.098, -.164);
      context.moveTo(.126, -.189); context.lineTo(.098, -.164);
      context.moveTo(-.093, .132); context.lineTo(-.065, .157);
      context.moveTo(.093, .132); context.lineTo(.065, .157);
      context.stroke();
      context.restore();
    }

    context.globalAlpha = alpha * (detailed ? .22 : .12);
    context.strokeStyle = "#e8f4ff";
    context.lineWidth = .003;
    context.beginPath();
    context.moveTo(-.18, -.208); context.quadraticCurveTo(-.219, -.11, -.176, -.035);
    context.moveTo(.18, -.208); context.quadraticCurveTo(.219, -.11, .176, -.035);
    context.moveTo(-.08, -.287); context.quadraticCurveTo(-.14, -.21, -.127, -.13);
    context.moveTo(.08, -.287); context.quadraticCurveTo(.14, -.21, .127, -.13);
    context.stroke();
    context.restore();
  }

  function drawSwingScene(time, elapsed, network, camera) {
    let activeShot = null;
    let shotProgress = 0;
    let swingProgress = 0;
    for (const shot of swingShots) {
      if (elapsed >= shot.shoot && elapsed <= shot.end) {
        activeShot = shot;
        shotProgress = clamp((elapsed - shot.shoot) / (shot.attach - shot.shoot), 0, 1);
        swingProgress = clamp((elapsed - shot.begin) / (shot.end - shot.begin), 0, 1);
        break;
      }
    }

    if (!activeShot) {
      const nextShot = swingShots.find(shot => elapsed < shot.shoot);
      if (elapsed < swingShots[0].shoot || !nextShot) return;
      return;
    }

    const shot = activeShot;
    const flying = elapsed < shot.attach;
    const eased = smooth(swingProgress);
    let position = flying
      ? { x: shot.from[0] * width, y: shot.from[1] * height }
      : positionForShot(shot, eased);
    let scale = mobile ? .25 : .2;
    if (shot === swingShots[2]) {
      const rush = smooth((elapsed - 7100) / 950);
      scale *= 1 + rush * 2.8;
      position = {
        x: position.x * width + (width * .5 - position.x * width) * rush,
        y: position.y * height + (height * .48 - position.y * height) * rush
      };
    } else {
      position = { x: position.x * width, y: position.y * height };
    }

    position.x -= camera.trackX * width;
    position.y -= camera.trackY * height;
    const anchor = {
      x: shot.anchor[0] * width - camera.trackX * width,
      y: shot.anchor[1] * height - camera.trackY * height
    };
    const aim = { x: anchor.x, y: anchor.y };
    const direction = aim.x < position.x ? -1 : 1;
    const hand = {
      x: position.x + direction * Math.min(width, height) * scale * .32,
      y: position.y - Math.min(width, height) * scale * .37
    };
    const velocity = positionForShot(shot, Math.min(1, eased + .025));
    const nextPosition = { x: velocity.x * width, y: velocity.y * height };
    const velocityX = nextPosition.x - position.x;
    const velocityY = nextPosition.y - position.y;
    const angle = flying ? direction * -.34 :
      clamp(Math.atan2(velocityY, velocityX) * .48 + Math.sin(time * .004) * .045, -.82, .82);

    drawAnchor(anchor.x, anchor.y, flying ? 1 - shotProgress : .35 + .35 * Math.sin(time * .014), network);
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = flying ? .22 + shotProgress * .78 : .92;
    context.strokeStyle = network > .5 ? "#68eaff" : "#f7faff";
    context.shadowColor = network > .5 ? "#38cfff" : "#ff5578";
    context.shadowBlur = flying ? 14 : 7;
    context.lineWidth = flying ? 2.5 : 1.35;
    context.beginPath();
    context.moveTo(hand.x, hand.y);
    if (flying) {
      const end = {
        x: hand.x + (anchor.x - hand.x) * shotProgress,
        y: hand.y + (anchor.y - hand.y) * shotProgress
      };
      context.lineTo(end.x, end.y);
    } else {
      const slack = (1 - smooth((elapsed - shot.attach) / 440)) * 18;
      context.quadraticCurveTo((hand.x + anchor.x) * .5, (hand.y + anchor.y) * .5 + slack, anchor.x, anchor.y);
    }
    context.stroke();
    if (flying && shotProgress < .62) {
      context.globalAlpha = .8;
      context.beginPath();
      context.arc(hand.x + (anchor.x - hand.x) * shotProgress, hand.y + (anchor.y - hand.y) * shotProgress, 3.2, 0, Math.PI * 2);
      context.fillStyle = "#fff";
      context.fill();
    }
    context.restore();

    const blur = mobile ? 1 : 4;
    if (!flying && swingProgress > .05 && swingProgress < .95) {
      for (let trail = blur; trail > 0; trail--) {
        const old = positionForShot(shot, clamp(eased - trail * .024, 0, 1));
        drawSilhouette(old.x * width, old.y * height, scale, angle,
          { backArm: [[-.08, -.15], [-.31, -.03], [-.3, .13]], backLeg: [[-.07, .24], [-.23, .42], [-.31, .4]],
            freeLeg: [[.07, .24], [.25, .32], [.32, .29]], webArm: [[.08, -.14], [.28, -.31], [.38, -.4]] },
          .045 * (blur - trail + 1));
      }
    }
    const tuck = .055 + Math.max(0, velocityY / Math.max(1, height)) * .1;
    const pose = {
      backArm: [[-.09, -.15], [-.25, -.03], [-.3, .09]],
      backLeg: [[-.07, .23], [-.2, .32 + tuck], [-.29, .27 + tuck]],
      freeLeg: [[.065, .23], [.16, .36 + tuck], [.3, .4 + tuck]],
      webArm: [[.085, -.15], [.2, -.31], [.32, -.39]]
    };
    drawSilhouette(position.x, position.y, scale, angle, pose, 1);
  }

  function drawFinalWebTransition(elapsed) {
    const spread = smooth((elapsed - 7600) / 520) * (1 - smooth((elapsed - 8620) / 700));
    if (spread <= 0) return;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = spread * .75;
    context.strokeStyle = "#a9f4ff";
    context.shadowColor = "#44d7ff";
    context.shadowBlur = 16;
    context.lineWidth = mobile ? 1 : 1.35;
    const centerX = width * .5;
    const centerY = height * .48;
    const radius = Math.hypot(width, height) * (.08 + spread * 1.35);
    for (let ray = 0; ray < 28; ray++) {
      const angle = ray / 28 * Math.PI * 2;
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
      context.stroke();
    }
    for (let ring = 1; ring <= 7; ring++) {
      const ringRadius = radius * ring / 7;
      context.beginPath();
      for (let point = 0; point <= 100; point++) {
        const angle = point / 100 * Math.PI * 2;
        const wobble = 1 + Math.sin(angle * 5 + ring) * .025;
        const x = centerX + Math.cos(angle) * ringRadius * wobble;
        const y = centerY + Math.sin(angle) * ringRadius * wobble;
        if (point === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.restore();
    const flash = smooth((elapsed - 8140) / 480) * (1 - smooth((elapsed - 8660) / 540));
    if (flash > 0) {
      context.save();
      context.globalAlpha = flash * .58;
      context.fillStyle = "#8aefff";
      context.fillRect(0, 0, width, height);
      context.restore();
    }
  }

  function drawWeb(time, formation, network, camera) {
    if (formation <= 0) return;
    const cyanMix = smooth(network);
    const webOpacity = 1 - smooth((cyanMix - .08) / .92) * .97;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    for (let spoke = 0; spoke < spokeCount; spoke++) {
      const angle = spoke / spokeCount * Math.PI * 2 + .04;
      const spokeProgress = clamp((formation * 1.14 - spoke / spokeCount * .21) / .79, 0, 1);
      if (spokeProgress <= 0) continue;
      context.beginPath();
      for (let index = 0; index <= pointsPerRing * spokeProgress; index++) {
        const radius = index / pointsPerRing * .99;
        const point = project(angle, radius, time, camera);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      const warm = spoke % 4 === 0;
      context.globalAlpha = (.18 + .22 * (1 - cyanMix)) * webOpacity * (spoke % 2 ? .74 : 1);
      context.strokeStyle = warm
        ? `rgba(${Math.round(255 - 153 * cyanMix)},${Math.round(59 + 172 * cyanMix)},${Math.round(94 + 161 * cyanMix)},1)`
        : `rgba(${Math.round(35 + 65 * cyanMix)},${Math.round(109 + 126 * cyanMix)},255,1)`;
      context.lineWidth = (warm ? 1.12 : .8) + cyanMix * .22;
      context.shadowColor = warm ? (cyanMix > .5 ? "#53e5ff" : "#ff395f") : "#287fff";
      context.shadowBlur = 8 + 6 * (1 - cyanMix);
      context.stroke();
    }
    for (let ring = 0; ring < ringCount; ring++) {
      const radius = (ring + 1) / ringCount;
      const ringProgress = clamp((formation * 1.25 - radius * .23) / .77, 0, 1);
      const segmentCount = Math.floor(pointsPerRing * ringProgress);
      if (!segmentCount) continue;
      context.beginPath();
      for (let segment = 0; segment <= segmentCount; segment++) {
        const angle = segment / pointsPerRing * Math.PI * 2;
        const point = project(angle, radius, time, camera);
        if (segment === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.globalAlpha = (.29 - radius * .12) * webOpacity * (1 - cyanMix * .2);
      context.lineWidth = .72 + (ring % 3 === 0 ? .32 : 0);
      context.strokeStyle = cyanMix > .6 ? "rgba(86,221,255,1)" :
        ring % 3 === 0 ? "rgba(255,80,116,1)" : "rgba(58,146,255,1)";
      context.shadowColor = cyanMix > .5 ? "#43dfff" : "#648fff";
      context.shadowBlur = 7;
      context.stroke();
    }
    if (formation > .55) {
      const nodeStep = mobile ? 12 : 8;
      context.shadowBlur = 10;
      for (let ring = 0; ring < ringCount; ring++) {
        const radius = (ring + 1) / ringCount;
        for (let spoke = 0; spoke < spokeCount; spoke += nodeStep === 12 ? 3 : 2) {
          const point = project(spoke / spokeCount * Math.PI * 2 + .04, radius, time, camera);
          context.globalAlpha = (.3 + .5 * cyanMix) * formation * webOpacity * .45;
          context.fillStyle = cyanMix > .4 ? "#70edff" : spoke % 2 ? "#ff5a79" : "#61a7ff";
          context.beginPath();
          context.arc(point.x, point.y, mobile ? 1.1 : 1.5, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
    context.restore();
  }

  function drawDigitalGrid(network) {
    if (network <= .01) return;
    const alpha = smooth(network) * .19;
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = "#35caff";
    context.lineWidth = .65;
    const step = mobile ? 52 : 68;
    const offset = width * .5 % step;
    for (let x = -offset; x < width; x += step) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let y = height * .49 % step; y < height; y += step) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    context.restore();
  }

  function drawParticles(time, network, camera) {
    context.save();
    for (const particle of particles) {
      const depth = .7 + Math.sin(time * particle.speed + particle.phase) * .25;
      const drift = time * particle.speed * .008;
      const px = ((particle.x + drift + 1) % 1) * width;
      const py = ((particle.y - drift * .28 + 1) % 1) * height;
      const scale = .45 + particle.z * 1.15;
      const alpha = (.12 + .43 * particle.z) * (network > .5 ? .65 + .25 * Math.sin(time * .002 + particle.phase) : 1);
      context.globalAlpha = alpha;
      context.fillStyle = particle.phase % 2 > 1 ? (network > .5 ? "#72e9ff" : "#ff5376") : "#6cafff";
      context.beginPath();
      context.arc(px + camera.yaw * 42 * depth - camera.trackX * width * .42,
        py + camera.pitch * 30 * depth - camera.trackY * height * .42,
        particle.size * scale, 0, Math.PI * 2);
      context.fill();
        if (!mobile && time > 2800 && time < 7800 && particle.z > .65) {
        context.globalAlpha = alpha * .28;
        context.fillRect(px - 11 * camera.zoom, py, 15 * camera.zoom, .8);
      }
    }
    context.restore();
  }

  function render(time, frozen) {
    if (dismissed || !context) return;
    if (!startedAt) startedAt = time;
    const elapsed = reducedMotion || frozen ? duration : time - startedAt;
    let lowerMilestone = progressMilestones[0];
    let upperMilestone = progressMilestones[progressMilestones.length - 1];
    for (let index = 1; index < progressMilestones.length; index++) {
      if (elapsed < progressMilestones[index].time) {
        upperMilestone = progressMilestones[index];
        lowerMilestone = progressMilestones[index - 1];
        break;
      }
    }
    const progressFraction = clamp((elapsed - lowerMilestone.time) /
      Math.max(1, upperMilestone.time - lowerMilestone.time), 0, 1);
    const progress = Math.round(lowerMilestone.value +
      (upperMilestone.value - lowerMilestone.value) * progressFraction);
    if (progress !== lastDisplayedProgress) {
      lastDisplayedProgress = progress;
      hudProgress.setAttribute("aria-valuenow", String(progress));
      hudProgressFill.style.width = `${progress}%`;
      hudPercent.textContent = `${progress}%`;
      if (progress >= 100) {
        hudStatus.textContent = "SECURITY SYSTEM ONLINE_";
        hudSubstatus.textContent = "THREAT MONITORING ACTIVE_";
      }
    }
    const formation = smooth((elapsed - 300) / 3450);
    const network = smooth((elapsed - 4930) / 3000);
    const flyIn = smooth((elapsed - 5520) / 2300);
    const flyOut = smooth((elapsed - 7700) / 850);
    const zoom = 1 + flyIn * .48 + flyOut * .64;
    const automatic = mobile ? .1 : .055;
    const activeShot = swingShots.find(shot => elapsed >= shot.shoot && elapsed <= shot.end);
    let trackX = 0;
    let trackY = 0;
    if (activeShot) {
      const movement = smooth(clamp((elapsed - activeShot.begin) / (activeShot.end - activeShot.begin), 0, 1));
      const followed = positionForShot(activeShot, movement);
      const rush = activeShot === swingShots[2] ? smooth((elapsed - 7100) / 950) : 0;
      const targetX = followed.x + (.5 - followed.x) * rush;
      const targetY = followed.y + (.48 - followed.y) * rush;
      trackX = clamp((targetX - .5) * .28, -.14, .14) * smooth((elapsed - activeShot.begin) / 280);
      trackY = clamp((targetY - .5) * .18, -.08, .08) * smooth((elapsed - activeShot.begin) / 280);
    }
    const camera = {
      yaw: Math.sin(time * .00035) * automatic + pointerX * (mobile ? .045 : .16),
      pitch: Math.cos(time * .00029) * automatic + pointerY * (mobile ? .035 : .12),
      zoom, trackX, trackY
    };
    context.fillStyle = "#02040a";
    context.fillRect(0, 0, width, height);
    drawCity(elapsed, camera);
    drawDigitalGrid(network);
    drawThread(elapsed, smooth((elapsed - 120) / 500));
    drawWeb(time, formation, network, camera);
    drawParticles(time, network, camera);
    drawSwingScene(time, elapsed, network, camera);
    drawFinalWebTransition(elapsed);

    if (elapsed > 0 && elapsed < 1800) intro.classList.add("is-thread");
    if (elapsed >= 9100) intro.classList.add("is-network", "is-online", "is-title");
    if (elapsed >= 10000) {
      intro.classList.add("is-entry");
      document.querySelector("#cinemaEntry").setAttribute("aria-hidden", "false");
      if (document.activeElement === document.body || document.activeElement.id === "cinemaSkip") {
        intro.querySelector("[data-go='participant-details']").focus({ preventScroll: true });
      }
    }
    if (elapsed >= duration) {
      return;
    }
    if (!frozen) frame = requestAnimationFrame(render);
  }

  intro.addEventListener("pointermove", event => {
    if (mobile) return;
    pointerX = (event.clientX / Math.max(1, width) - .5) * 2;
    pointerY = (event.clientY / Math.max(1, height) - .5) * 2;
  }, { passive: true });
  window.addEventListener("resize", resize, { passive: true });
  resize();
  if (reducedMotion) {
    intro.classList.add("is-title", "is-network", "is-online", "is-entry");
    document.querySelector("#cinemaEntry").setAttribute("aria-hidden", "false");
    render(performance.now(), true);
    intro.querySelector("[data-go='participant-details']").focus({ preventScroll: true });
  } else {
    document.querySelector("#cinemaSkip").focus({ preventScroll: true });
    frame = requestAnimationFrame(render);
  }
})();
