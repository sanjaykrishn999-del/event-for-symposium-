/* Lightweight original 3D-web-inspired canvas opening; no third-party renderer. */
(function () {
  const intro = document.querySelector("#cinematicIntro");
  const canvas = document.querySelector("#cinematicCanvas");
  const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = matchMedia("(max-width: 600px)").matches;
  const lowPower = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  const particleCount = reducedMotion ? 0 : mobile || lowPower ? 38 : 82;
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
  const duration = 11200;
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
    intro.classList.add("is-title", "is-network", "is-entry");
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
    ratio = Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (particles.length) return;
    for (let i = 0; i < particleCount; i++) {
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
    const baseline = height * .88;
    const drift = Math.sin(time * .00032 + camera.yaw) * width * .018 - camera.trackX * width * .24;
    context.fillStyle = "rgba(5,13,28,.74)";
    context.beginPath();
    context.moveTo(0, height);
    for (let index = 0; index <= 18; index++) {
      const x = index / 18 * width;
      const seed = (index * 37 + 11) % 9;
      const top = baseline - (height * (.08 + seed * .018));
      const left = x + drift;
      context.lineTo(left, top);
      context.lineTo(left + width / 32, top);
      context.lineTo(left + width / 32, height);
    }
    context.lineTo(0, height);
    context.fill();
    context.strokeStyle = "rgba(69,153,231,.14)";
    context.lineWidth = 1;
    for (let index = 0; index < 25; index++) {
      const x = (index * 83 + drift + width * 2) % width;
      const y = baseline - height * (.035 + (index % 5) * .022);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 2, y);
      context.stroke();
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
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.scale(unit, unit);
    context.globalAlpha = alpha;
    context.lineCap = "round";
    context.lineJoin = "round";

    const fabric = context.createLinearGradient(-.3, -.5, .34, .45);
    fabric.addColorStop(0, "#172538");
    fabric.addColorStop(.28, "#091322");
    fabric.addColorStop(.62, "#030811");
    fabric.addColorStop(.83, "#102237");
    fabric.addColorStop(1, "#050a12");
    const steel = "#030811";
    const seamBlue = "rgba(82,190,255,.68)";
    const seamRed = "rgba(255,73,111,.7)";

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
    const limb = (points, lineWidth, glow, highlight) => {
      linePath(points);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = steel;
      context.lineWidth = lineWidth;
      context.shadowColor = glow;
      context.shadowBlur = 9;
      context.stroke();
      context.shadowBlur = 0;
      linePath(points);
      context.strokeStyle = fabric;
      context.lineWidth = lineWidth * .71;
      context.stroke();
      linePath(points);
      context.strokeStyle = highlight;
      context.globalAlpha *= .72;
      context.lineWidth = .009;
      context.stroke();
      context.globalAlpha = alpha;
      const start = points[0], end = points[points.length - 1];
      for (const joint of [start, end]) {
        context.fillStyle = fabric;
        context.strokeStyle = glow;
        context.lineWidth = .009;
        context.beginPath();
        context.arc(joint[0], joint[1], lineWidth * .43, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    };
    const fillPanel = (path, stroke, lineWidth) => {
      context.beginPath();
      path();
      context.fillStyle = fabric;
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth;
      context.shadowColor = stroke;
      context.shadowBlur = 9;
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
    };

    limb(pose.backArm, .092, "#276aff", seamBlue);
    limb(pose.backLeg, .112, "#ef355f", seamRed);
    limb(pose.freeLeg, .112, "#247fff", seamBlue);
    limb(pose.webArm, .092, "#ff426e", seamRed);

    fillPanel(() => {
      context.moveTo(-.105, -.2);
      context.quadraticCurveTo(-.16, -.15, -.145, -.04);
      context.lineTo(-.112, .15);
      context.quadraticCurveTo(-.08, .23, -.018, .235);
      context.lineTo(.045, .235);
      context.quadraticCurveTo(.12, .2, .137, .1);
      context.lineTo(.135, -.105);
      context.quadraticCurveTo(.12, -.21, .072, -.23);
      context.lineTo(-.06, -.225);
      context.closePath();
    }, "rgba(101,185,244,.65)", .014);

    context.save();
    context.globalAlpha = .57;
    context.strokeStyle = seamBlue;
    context.lineWidth = .008;
    context.beginPath();
    context.moveTo(-.074, -.188); context.quadraticCurveTo(-.04, -.1, -.063, .052);
    context.moveTo(.074, -.19); context.quadraticCurveTo(.03, -.06, .086, .105);
    context.moveTo(-.096, -.078); context.quadraticCurveTo(0, -.028, .116, -.072);
    context.moveTo(-.099, .097); context.quadraticCurveTo(0, .13, .116, .084);
    context.stroke();
    context.globalAlpha = .37;
    context.strokeStyle = "rgba(185,211,233,.62)";
    context.beginPath();
    context.moveTo(-.056, -.14); context.quadraticCurveTo(-.026, -.124, -.04, -.084);
    context.moveTo(.046, .005); context.quadraticCurveTo(.022, .026, .045, .051);
    context.moveTo(-.015, .162); context.quadraticCurveTo(.005, .145, .022, .167);
    context.stroke();
    context.restore();

    fillPanel(() => {
      context.moveTo(-.075, -.28);
      context.quadraticCurveTo(-.12, -.43, -.07, -.49);
      context.quadraticCurveTo(0, -.548, .074, -.49);
      context.quadraticCurveTo(.118, -.427, .078, -.28);
      context.lineTo(.045, -.238);
      context.quadraticCurveTo(0, -.216, -.05, -.244);
      context.closePath();
    }, "rgba(93,196,255,.86)", .014);

    context.strokeStyle = "rgba(132,190,235,.52)";
    context.lineWidth = .007;
    context.beginPath();
    context.moveTo(-.08, -.414); context.quadraticCurveTo(0, -.45, .08, -.414);
    context.moveTo(-.062, -.29); context.quadraticCurveTo(0, -.26, .06, -.29);
    context.stroke();

    const lens = (side) => {
      context.beginPath();
      context.moveTo(side * .008, -.389);
      context.quadraticCurveTo(side * .035, -.427, side * .08, -.4);
      context.lineTo(side * .057, -.368);
      context.quadraticCurveTo(side * .031, -.357, side * .008, -.379);
      context.closePath();
      const reflection = context.createLinearGradient(0, -.43, 0, -.36);
      reflection.addColorStop(0, "#d8fbff");
      reflection.addColorStop(.28, "#58dfff");
      reflection.addColorStop(1, "#0875c4");
      context.fillStyle = reflection;
      context.shadowColor = "#3dd9ff";
      context.shadowBlur = 8;
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = "rgba(232,251,255,.88)";
      context.lineWidth = .005;
      context.stroke();
    };
    lens(-1);
    lens(1);

    fillPanel(() => {
      context.moveTo(-.112, .133);
      context.quadraticCurveTo(-.02, .175, .11, .13);
      context.lineTo(.079, .275);
      context.quadraticCurveTo(.17, .34, .12, .365);
      context.lineTo(.047, .344);
      context.lineTo(0, .282);
      context.lineTo(-.055, .351);
      context.quadraticCurveTo(-.158, .35, -.139, .307);
      context.lineTo(-.068, .247);
      context.closePath();
    }, "rgba(255,77,111,.48)", .01);

    context.strokeStyle = "rgba(114,201,255,.67)";
    context.lineWidth = .007;
    context.beginPath();
    context.moveTo(-.094, .173); context.quadraticCurveTo(-.045, .245, -.12, .307);
    context.moveTo(.094, .169); context.quadraticCurveTo(.036, .239, .116, .319);
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
    if (elapsed >= 8120) intro.classList.add("is-network", "is-title");
    if (elapsed >= 9540) {
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
    intro.classList.add("is-title", "is-network", "is-entry");
    document.querySelector("#cinemaEntry").setAttribute("aria-hidden", "false");
    render(performance.now(), true);
    intro.querySelector("[data-go='participant-details']").focus({ preventScroll: true });
  } else {
    document.querySelector("#cinemaSkip").focus({ preventScroll: true });
    frame = requestAnimationFrame(render);
  }
})();
