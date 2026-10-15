"use strict";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const $ = (id) => document.getElementById(id);

const distanceDisplay = $("distance");
const coinsDisplay = $("coins");
const speedDisplay = $("speed");
const fuelBar = $("fuelBar");
const fuelPercent = $("fuelPercent");

const startScreen = $("startScreen");
const gameOverScreen = $("gameOverScreen");
const pauseIndicator = $("pauseIndicator");

let W = 960;
let H = 540;

let running = false;
let gameOver = false;
let paused = false;
let lastTime = 0;

let distance = 0;
let totalCoins = 0;
let fuel = 100;
let speed = 0;
let cameraX = 0;

let terrain = [];
let objects = [];
let particles = [];

const keys = {
    accelerate: false,
    brake: false,
    leanForward: false,
    leanBackward: false
};

const bike = {
    x: 160,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    wheelRadius: 19,
    wheelRotation: 0,
    onGround: false
};

const GRAVITY = 1250;
const MAX_SPEED = 390;
const ACCELERATION = 225;
const FRICTION = 0.985;

let audioContext = null;
let soundEnabled = true;
let lastCoinSound = 0;

// --------------------------------------------------
// CANVAS
// --------------------------------------------------

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();

    W = Math.max(320, Math.round(rect.width));
    H = Math.max(240, Math.round(rect.height));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!running && !gameOver) {
        cameraX = 0;
        draw();
    }
}

window.addEventListener("resize", resizeCanvas);

// --------------------------------------------------
// TERRAIN GENERATION
// --------------------------------------------------

function terrainHeight(x) {
    return (
        H * 0.69 +
        Math.sin(x * 0.003) * 38 +
        Math.sin(x * 0.0067 + 1.4) * 24 +
        Math.sin(x * 0.012 + 0.8) * 9 +
        Math.sin(x * 0.0014) * 18
    );
}

function getGround(x) {
    if (terrain.length === 0) {
        return terrainHeight(x);
    }

    const index = Math.floor(x / 30);

    if (index < 0 || index >= terrain.length - 1) {
        return terrainHeight(x);
    }

    const a = terrain[index];
    const b = terrain[index + 1];

    const t = (x - index * 30) / 30;

    return a + (b - a) * t;
}

function getGroundAngle(x) {
    const left = getGround(x - 4);
    const right = getGround(x + 4);

    return Math.atan2(right - left, 8);
}

function generateTerrain() {
    terrain = [];

    for (let x = 0; x < 180; x++) {
        terrain.push(terrainHeight(x * 30));
    }
}

// --------------------------------------------------
// ENVIRONMENT OBJECTS
// --------------------------------------------------

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function createEnvironment() {
    objects = [];

    for (let x = 150; x < 8000; x += 150) {
        const typeRoll = Math.random();

        const type =
            typeRoll < 0.65
                ? "tree"
                : typeRoll < 0.82
                    ? "rock"
                    : "bush";

        objects.push({
            type,
            x: x + randomBetween(-50, 50),
            scale: randomBetween(0.65, 1.25)
        });
    }

    // Generate coins above the ground.
    for (let x = 350; x < 8000; x += 115) {
        if (Math.random() < 0.76) {
            const ground = terrainHeight(x);

            objects.push({
                type: "coin",
                x: x + randomBetween(-20, 20),
                y: ground - randomBetween(70, 120),
                collected: false
            });
        }
    }

    // Fuel pickups.
    for (let x = 1100; x < 8000; x += 1400) {
        objects.push({
            type: "fuel",
            x,
            y: terrainHeight(x) - 90,
            collected: false
        });
    }

    objects.sort((a, b) => a.x - b.x);
}

// --------------------------------------------------
// RESET GAME
// --------------------------------------------------

function resetGame() {
    distance = 0;
    totalCoins = 0;
    fuel = 100;
    speed = 0;
    cameraX = 0;

    particles = [];

    bike.x = 160;
    bike.y = terrainHeight(bike.x) - bike.wheelRadius - 14;

    bike.vx = 0;
    bike.vy = 0;
    bike.angle = 0;
    bike.angularVelocity = 0;
    bike.wheelRotation = 0;
    bike.onGround = true;

    keys.accelerate = false;
    keys.brake = false;
    keys.leanForward = false;
    keys.leanBackward = false;

    generateTerrain();
    createEnvironment();

    updateHUD();
    draw();
}

// --------------------------------------------------
// AUDIO
// --------------------------------------------------

function playSound(frequency = 600, duration = 0.08) {
    if (!soundEnabled) return;

    try {
        if (!audioContext) {
            audioContext = new (
                window.AudioContext ||
                window.webkitAudioContext
            )();
        }

        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = frequency;

        gain.gain.setValueAtTime(
            0.08,
            audioContext.currentTime
        );

        gain.gain.exponentialRampToValueAtTime(
            0.001,
            audioContext.currentTime + duration
        );

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start();
        oscillator.stop(
            audioContext.currentTime + duration
        );
    } catch (error) {
        // The game still works if audio is unavailable.
    }
}

$("soundBtn").addEventListener("click", () => {
    soundEnabled = !soundEnabled;

    $("soundBtn").textContent =
        soundEnabled ? "🔊" : "🔇";

    if (soundEnabled) {
        playSound(700);
    }
});

// --------------------------------------------------
// PARTICLES
// --------------------------------------------------

function createParticles(x, y, count = 8, color = "#ffd166") {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y,
            vx: randomBetween(-80, 80),
            vy: randomBetween(-120, -20),
            life: randomBetween(0.3, 0.7),
            maxLife: 0.7,
            size: randomBetween(2, 5),
            color
        });
    }
}

function updateParticles(dt) {
    for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        p.vy += 250 * dt;
        p.life -= dt;
    }

    particles = particles.filter(p => p.life > 0);
}

// --------------------------------------------------
// BIKE PHYSICS
// --------------------------------------------------

function updateBike(dt) {
    if (keys.accelerate && fuel > 0) {
        bike.vx += ACCELERATION * dt;

        fuel -= 4.0 * dt;
        fuel = Math.max(0, fuel);
    }

    if (keys.brake) {
        bike.vx -= 350 * dt;
    }

    if (!keys.accelerate && !keys.brake) {
        bike.vx *= Math.pow(FRICTION, dt * 60);
    }

    bike.vx = Math.max(
        -100,
        Math.min(MAX_SPEED, bike.vx)
    );

    if (bike.onGround) {
        const groundAngle = getGroundAngle(bike.x);

        bike.vy = 0;

        const desiredAngle = groundAngle;

        bike.angularVelocity +=
            (desiredAngle - bike.angle) * 8 * dt;

        bike.angularVelocity *= Math.pow(0.86, dt * 60);

        bike.angle += bike.angularVelocity * dt;

        if (keys.leanForward) {
            bike.angle += 1.1 * dt;
        }

        if (keys.leanBackward) {
            bike.angle -= 1.1 * dt;
        }

        // Ground follows the wheels.
        bike.y =
            getGround(bike.x) -
            bike.wheelRadius -
            13;

        // Small ramps can launch the bike.
        const slopeChange =
            getGroundAngle(bike.x + 15) -
            getGroundAngle(bike.x - 15);

        if (Math.abs(bike.vx) > 160 &&
            slopeChange < -0.18) {

            bike.onGround = false;
            bike.vy = -200;
        }
    } else {
        bike.vy += GRAVITY * dt;

        bike.x += bike.vx * dt;
        bike.y += bike.vy * dt;

        if (keys.leanForward) {
            bike.angularVelocity += 2.8 * dt;
        }

        if (keys.leanBackward) {
            bike.angularVelocity -= 2.8 * dt;
        }

        bike.angularVelocity *= Math.pow(0.995, dt * 60);
        bike.angle += bike.angularVelocity * dt;

        const ground = getGround(bike.x);

        if (bike.y + bike.wheelRadius + 13 >= ground) {
            const landingAngle = getGroundAngle(bike.x);

            bike.y = ground - bike.wheelRadius - 13;

            // Large landing angle differences are dangerous.
            const angleDifference = Math.abs(
                normalizeAngle(bike.angle - landingAngle)
            );

            if (angleDifference > 1.35 &&
                Math.abs(bike.vx) > 130) {
                endGame();
                return;
            }

            bike.onGround = true;
            bike.vy = 0;

            bike.angle = landingAngle;
            bike.angularVelocity = 0;

            createParticles(
                bike.x,
                bike.y + 15,
                5,
                "#d5b28b"
            );
        }
    }

    if (bike.onGround) {
        bike.x += bike.vx * dt;
    }

    bike.wheelRotation += bike.vx * dt / bike.wheelRadius;

    // Prevent the player from travelling backwards indefinitely.
    bike.x = Math.max(80, bike.x);

    // Fuel depletion ends the run when the bike is stopped.
    if (fuel <= 0 && Math.abs(bike.vx) < 8) {
        endGame();
    }

    if (bike.y > H + 150) {
        endGame();
    }

    speed = Math.round(Math.abs(bike.vx) * 0.45);
}

// Normalize angle to -PI ... PI.
function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;

    return angle;
}

// --------------------------------------------------
// COLLECTIBLES
// --------------------------------------------------

function updateObjects() {
    for (const obj of objects) {
        if (obj.collected) continue;

        if (obj.type !== "coin" && obj.type !== "fuel") {
            continue;
        }

        const dx = obj.x - bike.x;
        const dy = obj.y - (bike.y + 10);

        if (Math.hypot(dx, dy) < 35) {
            obj.collected = true;

            if (obj.type === "coin") {
                totalCoins++;

                createParticles(
                    obj.x,
                    obj.y,
                    10,
                    "#ffd166"
                );

                playSound(850, 0.1);
            } else {
                fuel = Math.min(100, fuel + 35);

                createParticles(
                    obj.x,
                    obj.y,
                    12,
                    "#71f5a5"
                );

                playSound(450, 0.15);
            }
        }
    }
}

// --------------------------------------------------
// HUD
// --------------------------------------------------

function updateHUD() {
    distanceDisplay.textContent =
        Math.max(0, Math.floor((bike.x - 160) / 10));

    coinsDisplay.textContent = totalCoins;

    speedDisplay.textContent = Math.floor(speed);

    fuelBar.style.width = fuel + "%";

    fuelPercent.textContent = Math.ceil(fuel) + "%";

    if (fuel < 25) {
        fuelBar.style.background =
            "linear-gradient(90deg, #ff4545, #ff8b55)";
    } else {
        fuelBar.style.background =
            "linear-gradient(90deg, #4ade80, #b9f76a)";
    }
}

// --------------------------------------------------
// BACKGROUND
// --------------------------------------------------

function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);

    sky.addColorStop(0, "#55b9ed");
    sky.addColorStop(0.55, "#a9e6f6");
    sky.addColorStop(1, "#f4e6ba");

    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sun.
    const sunX = W * 0.77;
    const sunY = H * 0.18;

    const glow = ctx.createRadialGradient(
        sunX,
        sunY,
        5,
        sunX,
        sunY,
        H * 0.17
    );

    glow.addColorStop(0, "#fff6c7bb");
    glow.addColorStop(1, "#fff6c700");

    ctx.fillStyle = glow;
    ctx.fillRect(
        sunX - H * 0.18,
        sunY - H * 0.18,
        H * 0.36,
        H * 0.36
    );

    ctx.fillStyle = "#fff3bd";
    ctx.beginPath();
    ctx.arc(sunX, sunY, H * 0.055, 0, Math.PI * 2);
    ctx.fill();

    drawClouds();
    drawMountains();
}

// --------------------------------------------------
// CLOUDS
// --------------------------------------------------

function drawClouds() {
    ctx.fillStyle = "#ffffffaa";

    for (let i = 0; i < 6; i++) {
        const baseX =
            ((i * 235 - cameraX * 0.08) %
                (W + 250) + W + 250) %
            (W + 250) - 100;

        const y = H * (0.10 + (i % 3) * 0.07);

        ctx.beginPath();

        ctx.ellipse(
            baseX,
            y,
            35,
            12,
            0,
            0,
            Math.PI * 2
        );

        ctx.ellipse(
            baseX - 20,
            y + 3,
            19,
            10,
            0,
            0,
            Math.PI * 2
        );

        ctx.ellipse(
            baseX + 19,
            y + 3,
            23,
            11,
            0,
            0,
            Math.PI * 2
        );

        ctx.fill();
    }
}

// --------------------------------------------------
// DISTANT MOUNTAINS
// --------------------------------------------------

function drawMountains() {
    const layers = [
        {
            color: "#87c6c0",
            height: 0.30,
            parallax: 0.10
        },
        {
            color: "#66a9a0",
            height: 0.22,
            parallax: 0.17
        },
        {
            color: "#438a76",
            height: 0.16,
            parallax: 0.24
        }
    ];

    for (const layer of layers) {
        ctx.fillStyle = layer.color;

        ctx.beginPath();
        ctx.moveTo(0, H);

        for (let x = 0; x <= W + 30; x += 30) {
            const worldX = x + cameraX * layer.parallax;

            const y =
                H * (0.63 - layer.height) +
                Math.sin(worldX * 0.004) * H * 0.04 +
                Math.sin(worldX * 0.011) * H * 0.025;

            ctx.lineTo(x, y);
        }

        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
    }
}

// --------------------------------------------------
// TERRAIN DRAWING
// --------------------------------------------------

function drawTerrain() {
    const startX = cameraX - 100;
    const endX = cameraX + W + 150;

    // Main soil.
    ctx.beginPath();
    ctx.moveTo(0, H);

    for (let x = startX; x <= endX; x += 8) {
        ctx.lineTo(
            x - cameraX,
            getGround(x)
        );
    }

    ctx.lineTo(W, H);
    ctx.closePath();

    const soilGradient = ctx.createLinearGradient(
        0,
        H * 0.55,
        0,
        H
    );

    soilGradient.addColorStop(0, "#6cbe50");
    soilGradient.addColorStop(0.07, "#458a3b");
    soilGradient.addColorStop(0.25, "#8a5a38");
    soilGradient.addColorStop(1, "#543724");

    ctx.fillStyle = soilGradient;
    ctx.fill();

    // Grass outline.
    ctx.beginPath();

    for (let x = startX; x <= endX; x += 8) {
        const sx = x - cameraX;
        const sy = getGround(x);

        if (x === startX) {
            ctx.moveTo(sx, sy);
        } else {
            ctx.lineTo(sx, sy);
        }
    }

    ctx.strokeStyle = "#b3eb65";
    ctx.lineWidth = 5;
    ctx.stroke();

    // Grass highlights.
    ctx.strokeStyle = "#e0f59b";
    ctx.lineWidth = 1.5;

    for (let x = startX; x <= endX; x += 23) {
        const sx = x - cameraX;
        const sy = getGround(x);

        ctx.beginPath();
        ctx.moveTo(sx, sy - 2);
        ctx.lineTo(sx + 3, sy - 7);
        ctx.stroke();
    }

    // Soil texture.
    for (let x = startX; x <= endX; x += 53) {
        const sx = x - cameraX;
        const sy = getGround(x);

        ctx.fillStyle = "#b88a5c66";

        ctx.fillRect(
            sx,
            sy + 22,
            12,
            3
        );

        ctx.fillStyle = "#3d2a2455";

        ctx.fillRect(
            sx + 20,
            sy + 40,
            8,
            3
        );
    }
}

// --------------------------------------------------
// TREES AND ROCKS
// --------------------------------------------------

function drawTree(x, ground, scale) {
    ctx.save();

    ctx.translate(x, ground);
    ctx.scale(scale, scale);

    // Tree trunk.
    ctx.fillStyle = "#755039";

    ctx.fillRect(-5, -47, 10, 47);

    // Layered foliage.
    const leaves = [
        { y: -80, width: 34, color: "#246b45" },
        { y: -98, width: 28, color: "#2f8750" },
        { y: -114, width: 21, color: "#48a95b" }
    ];

    for (const leaf of leaves) {
        ctx.fillStyle = leaf.color;

        ctx.beginPath();
        ctx.moveTo(0, leaf.y - 28);
        ctx.lineTo(-leaf.width, leaf.y + 8);
        ctx.lineTo(leaf.width, leaf.y + 8);
        ctx.closePath();
        ctx.fill();
    }

    // Light foliage highlight.
    ctx.fillStyle = "#76c76b";

    ctx.beginPath();
    ctx.moveTo(-3, -131);
    ctx.lineTo(-10, -104);
    ctx.lineTo(5, -109);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function drawRock(x, ground, scale) {
    ctx.save();

    ctx.translate(x, ground);
    ctx.scale(scale, scale);

    ctx.fillStyle = "#65757c";

    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(-14, -17);
    ctx.lineTo(-1, -26);
    ctx.lineTo(14, -18);
    ctx.lineTo(23, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#a8b8bc";

    ctx.beginPath();
    ctx.moveTo(-14, -17);
    ctx.lineTo(-1, -26);
    ctx.lineTo(4, -17);
    ctx.lineTo(-7, -13);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function drawBush(x, ground, scale) {
    ctx.save();

    ctx.translate(x, ground);
    ctx.scale(scale, scale);

    ctx.fillStyle = "#34814a";

    for (const leaf of [
        [-8, -7, 11],
        [3, -12, 13],
        [14, -6, 9]
    ]) {
        ctx.beginPath();
        ctx.arc(leaf[0], leaf[1], leaf[2], 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawObjects() {
    for (const obj of objects) {
        const screenX = obj.x - cameraX;

        if (screenX < -100 || screenX > W + 100) {
            continue;
        }

        if (obj.type === "tree") {
            drawTree(
                screenX,
                getGround(obj.x),
                obj.scale
            );
        }

        if (obj.type === "rock") {
            drawRock(
                screenX,
                getGround(obj.x),
                obj.scale
            );
        }

        if (obj.type === "bush") {
            drawBush(
                screenX,
                getGround(obj.x),
                obj.scale
            );
        }

        if (obj.type === "coin" && !obj.collected) {
            drawCoin(screenX, obj.y);
        }

        if (obj.type === "fuel" && !obj.collected) {
            drawFuel(screenX, obj.y);
        }
    }
}

// --------------------------------------------------
// COINS
// --------------------------------------------------

function drawCoin(x, y) {
    const pulse =
        1 + Math.sin(performance.now() * 0.006 + x) * 0.08;

    ctx.save();

    ctx.translate(x, y);
    ctx.scale(pulse, 1);

    ctx.fillStyle = "#d89120";

    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffd166";

    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#fff0a3";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
}

// --------------------------------------------------
// FUEL PICKUP
// --------------------------------------------------

function drawFuel(x, y) {
    ctx.save();

    ctx.translate(x, y);

    ctx.fillStyle = "#2f6f54";

    ctx.beginPath();
    ctx.roundRect(-10, -13, 20, 27, 4);
    ctx.fill();

    ctx.fillStyle = "#71f5a5";

    ctx.fillRect(-6, -8, 12, 15);

    ctx.fillStyle = "#ffffff";

    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";

    ctx.fillText("+", 0, 2);

    ctx.restore();
}

// --------------------------------------------------
// BIKE DRAWING
// --------------------------------------------------

function drawWheel(x, y, radius) {
    ctx.save();

    ctx.translate(x, y);

    // Tire.
    ctx.fillStyle = "#17212a";

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // Outer rubber highlight.
    ctx.strokeStyle = "#45545f";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(0, 0, radius - 2, 0, Math.PI * 2);
    ctx.stroke();

    // Rim.
    ctx.fillStyle = "#cbd5df";

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.64, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#697986";

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.49, 0, Math.PI * 2);
    ctx.fill();

    // Spokes.
    ctx.strokeStyle = "#e2e8ed";
    ctx.lineWidth = 1.5;

    for (let i = 0; i < 8; i++) {
        const angle =
            bike.wheelRotation +
            i * Math.PI / 4;

        ctx.beginPath();

        ctx.moveTo(0, 0);

        ctx.lineTo(
            Math.cos(angle) * radius * 0.57,
            Math.sin(angle) * radius * 0.57
        );

        ctx.stroke();
    }

    // Hub.
    ctx.fillStyle = "#ff963d";

    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawBike() {
    const groundY = getGround(bike.x);

    const screenX = bike.x - cameraX;
    const screenY = bike.y;

    const wheelOffset = 31;
    const wheelY = 13;

    ctx.save();

    ctx.translate(screenX, screenY);
    ctx.rotate(bike.angle);

    // Bike shadow.
    ctx.fillStyle = "#132c2855";

    ctx.beginPath();
    ctx.ellipse(0, 34, 47, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wheels.
    drawWheel(-wheelOffset, wheelY, bike.wheelRadius);
    drawWheel(wheelOffset, wheelY, bike.wheelRadius);

    // Frame.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "#f06b27";
    ctx.lineWidth = 6;

    ctx.beginPath();
    ctx.moveTo(-wheelOffset, wheelY);
    ctx.lineTo(-5, -2);
    ctx.lineTo(wheelOffset, wheelY);
    ctx.lineTo(7, -7);
    ctx.lineTo(-wheelOffset, wheelY);
    ctx.stroke();

    // Main frame detail.
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(-5, -2);
    ctx.lineTo(7, -7);
    ctx.stroke();

    // Seat.
    ctx.strokeStyle = "#17212a";
    ctx.lineWidth = 7;

    ctx.beginPath();
    ctx.moveTo(-13, -12);
    ctx.lineTo(1, -12);
    ctx.stroke();

    // Front fork.
    ctx.strokeStyle = "#b9c6d1";
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.moveTo(wheelOffset, wheelY);
    ctx.lineTo(18, -12);
    ctx.lineTo(13, -24);
    ctx.stroke();

    // Handlebar.
    ctx.strokeStyle = "#202d38";
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.moveTo(9, -24);
    ctx.lineTo(22, -24);
    ctx.stroke();

    // Rear suspension.
    ctx.strokeStyle = "#d5dde4";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(-wheelOffset + 8, wheelY - 5);
    ctx.lineTo(-6, -2);
    ctx.stroke();

    // Rider body.
    ctx.strokeStyle = "#1c3449";
    ctx.lineWidth = 11;

    ctx.beginPath();
    ctx.moveTo(-7, -18);
    ctx.lineTo(2, -37);
    ctx.stroke();

    // Rider's jacket.
    ctx.strokeStyle = "#2d9ce8";
    ctx.lineWidth = 9;

    ctx.beginPath();
    ctx.moveTo(-7, -18);
    ctx.lineTo(2, -37);
    ctx.stroke();

    // Rider's leg.
    ctx.strokeStyle = "#263343";
    ctx.lineWidth = 6;

    ctx.beginPath();
    ctx.moveTo(-6, -18);
    ctx.lineTo(-17, -4);
    ctx.lineTo(-6, 2);
    ctx.stroke();

    // Rider's arm.
    ctx.strokeStyle = "#eab18a";
    ctx.lineWidth = 5;

    ctx.beginPath();
    ctx.moveTo(0, -33);
    ctx.lineTo(12, -25);
    ctx.stroke();

    // Helmet.
    ctx.fillStyle = "#ffb52e";

    ctx.beginPath();
    ctx.arc(3, -44, 10, 0, Math.PI * 2);
    ctx.fill();

    // Helmet visor.
    ctx.fillStyle = "#26394b";

    ctx.beginPath();
    ctx.ellipse(10, -43, 6, 3, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Helmet shine.
    ctx.fillStyle = "#fff1b8";

    ctx.beginPath();
    ctx.arc(0, -48, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// --------------------------------------------------
// PARTICLE DRAWING
// --------------------------------------------------

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(
            0,
            p.life / p.maxLife
        );

        ctx.fillStyle = p.color;

        ctx.beginPath();
        ctx.arc(
            p.x - cameraX,
            p.y,
            p.size,
            0,
            Math.PI * 2
        );

        ctx.fill();
    }

    ctx.globalAlpha = 1;
}

// --------------------------------------------------
// DRAW EVERYTHING
// --------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, W, H);

    drawBackground();
    drawTerrain();
    drawObjects();
    drawBike();
    drawParticles();

    // Small speed trail.
    if (Math.abs(bike.vx) > 220) {
        ctx.strokeStyle = "#ffffff44";
        ctx.lineWidth = 2;

        for (let i = 0; i < 4; i++) {
            const y = bike.y + i * 7;

            ctx.beginPath();
            ctx.moveTo(
                bike.x - cameraX - 45 - i * 8,
                y
            );

            ctx.lineTo(
                bike.x - cameraX - 60 - i * 8,
                y
            );

            ctx.stroke();
        }
    }
}

// --------------------------------------------------
// GAME LOOP
// --------------------------------------------------

function update(dt) {
    if (!running || paused || gameOver) {
        return;
    }

    updateBike(dt);

    if (!running || gameOver) {
        return;
    }

    cameraX = Math.max(
        0,
        bike.x - W * 0.32
    );

    updateObjects();
    updateParticles(dt);

    distance = Math.max(
        distance,
        Math.floor((bike.x - 160) / 10)
    );

    updateHUD();
}

function loop(timestamp) {
    const dt = Math.min(
        (timestamp - lastTime) / 1000 || 0,
        0.033
    );

    lastTime = timestamp;

    update(dt);
    draw();

    requestAnimationFrame(loop);
}

// --------------------------------------------------
// GAME START AND GAME OVER
// --------------------------------------------------

function startGame() {
    resetGame();

    running = true;
    gameOver = false;
    paused = false;

    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    pauseIndicator.classList.add("hidden");

    lastTime = performance.now();

    playSound(450);
}

function endGame() {
    if (gameOver) return;

    running = false;
    gameOver = true;
    paused = false;

    keys.accelerate = false;
    keys.brake = false;

    $("finalDistance").textContent =
        Math.max(0, Math.floor((bike.x - 160) / 10)) + " m";

    $("finalCoins").textContent = totalCoins;

    gameOverScreen.classList.remove("hidden");
    pauseIndicator.classList.add("hidden");

    playSound(180, 0.25);
}

function togglePause() {
    if (!running || gameOver) return;

    paused = !paused;

    pauseIndicator.classList.toggle(
        "hidden",
        !paused
    );

    $("pauseBtn").querySelector("span").textContent =
        paused ? "▶" : "Ⅱ";

    if (paused) {
        keys.accelerate = false;
        keys.brake = false;
    }

    lastTime = performance.now();
}

// --------------------------------------------------
// KEYBOARD CONTROLS
// --------------------------------------------------

window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if ([
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        " "
    ].includes(key)) {
        event.preventDefault();
    }

    if (key === "arrowright" || key === "d" || key === "w") {
        keys.accelerate = true;
    }

    if (key === "arrowleft" || key === "a" || key === "s") {
        keys.brake = true;
    }

    if (key === "arrowup") {
        keys.leanBackward = true;
    }

    if (key === "arrowdown") {
        keys.leanForward = true;
    }

    if (key === "escape" || key === "p") {
        togglePause();
    }
});

window.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();

    if (key === "arrowright" || key === "d" || key === "w") {
        keys.accelerate = false;
    }

    if (key === "arrowleft" || key === "a" || key === "s") {
        keys.brake = false;
    }

    if (key === "arrowup") {
        keys.leanBackward = false;
    }

    if (key === "arrowdown") {
        keys.leanForward = false;
    }
});

window.addEventListener("blur", () => {
    keys.accelerate = false;
    keys.brake = false;
    keys.leanForward = false;
    keys.leanBackward = false;
});

// --------------------------------------------------
// TOUCHSCREEN CONTROLS
// --------------------------------------------------

function bindHoldButton(buttonId, keyName) {
    const button = $(buttonId);

    const press = (event) => {
        event.preventDefault();

        keys[keyName] = true;
        button.classList.add("pressed");

        if (button.setPointerCapture &&
            event.pointerId !== undefined) {
            try {
                button.setPointerCapture(event.pointerId);
            } catch (error) {
                // Pointer capture may be unavailable.
            }
        }
    };

    const release = (event) => {
        if (event) event.preventDefault();

        keys[keyName] = false;
        button.classList.remove("pressed");
    };

    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    button.addEventListener("contextmenu", event => {
        event.preventDefault();
    });
}

bindHoldButton("accelerateBtn", "accelerate");
bindHoldButton("brakeBtn", "brake");

// --------------------------------------------------
// BUTTON EVENTS
// --------------------------------------------------

$("startBtn").addEventListener("click", startGame);

$("restartBtn").addEventListener("click", startGame);

$("pauseBtn").addEventListener("click", togglePause);

// --------------------------------------------------
// INITIALIZATION
// --------------------------------------------------

resizeCanvas();
resetGame();

requestAnimationFrame((timestamp) => {
    lastTime = timestamp;
    loop(timestamp);
});