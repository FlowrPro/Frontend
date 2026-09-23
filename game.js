const canvas = document.querySelector('#game-canvas');
const context = canvas.getContext('2d');
const minimapCanvas = document.querySelector('#minimap-canvas');
const minimapContext = minimapCanvas.getContext('2d');
const inventoryPanel = document.querySelector('#inventory-panel');
const inventoryGrid = document.querySelector('#inventory-grid');
const hotbarSlots = document.querySelector('#hotbar-slots');
const secondaryHotbarSlots = document.querySelector('#secondary-hotbar-slots');
const inventoryButton = document.querySelector('[data-action="inventory"]');
const chatPanel = document.querySelector('#chat-panel');
const chatMessages = document.querySelector('#chat-messages');
const chatInput = document.querySelector('#chat-input');
const deathOverlay = document.querySelector('#death-overlay');
const respawnButton = document.querySelector('#respawn-button');
const inventoryClose = document.querySelector('#inventory-close');
const homeScreen = document.querySelector('#home-screen');
const gameShell = document.querySelector('#game-shell');
const playForm = document.querySelector('#play-form');
const usernameInput = document.querySelector('#username-input');

// World dimensions and spawn coordinates are intentionally easy to edit.
const WORLD = {
  width: 3200,
  height: 3200,
  spawnX: 1600,
  spawnY: 1600,
  border: 260,
};

const player = {
  x: WORLD.spawnX,
  y: WORLD.spawnY,
  authoritativeX: WORLD.spawnX,
  authoritativeY: WORLD.spawnY,
  authoritativeVelocityX: 0,
  authoritativeVelocityY: 0,
  renderX: WORLD.spawnX,
  renderY: WORLD.spawnY,
  radius: 31,
  speed: 310,
  velocityX: 0,
  velocityY: 0,
  orbitRadius: 86,
  reloadAnimations: new Map(),
};

const SERVER_URL = 'wss://backend-v4ok.onrender.com';
let socket = null;
let localPlayerId = null;
const remotePlayers = new Map();
const mobs = new Map();
let networkSendTimer = 0;
let selectedUsername = '';
let hasStartedGame = false;
const MOVEMENT_ACCELERATION = 1700;
const MOVEMENT_DECELERATION = 2100;

const camera = { x: player.x, y: player.y };
const keys = new Set();
const grassTexture = new Image();
const borderTexture = new Image();
let grassPattern = null;
let borderPattern = null;
const grassTextureScale = 0.5;
const borderTextureScale = 1;
const PETAL_ROTATION_MS = 4200;
const HOTBAR_SIZE = 10;
let PETAL_RARITIES = [
  { id: 'common', label: 'Common', color: '#9ea4ad', multiplier: 1 },
  { id: 'unusual', label: 'Unusual', color: '#55c878', multiplier: 3 },
  { id: 'rare', label: 'Rare', color: '#55a9e8', multiplier: 9 },
  { id: 'epic', label: 'Epic', color: '#bd67e8', multiplier: 27 },
  { id: 'legendary', label: 'Legendary', color: '#f2a43c', multiplier: 81 },
  { id: 'mythical', label: 'Mythical', color: '#ed5b75', multiplier: 243 },
  { id: 'ultra', label: 'Ultra', color: '#f5df66', multiplier: 729 },
];
let PETAL_TYPES = {
  1: { id: 1, label: 'Basic', baseDamage: 10, baseHealth: 10, baseReload: 1.2 },
};
let rarityById = new Map(PETAL_RARITIES.map((rarity) => [rarity.id, rarity]));
const inventory = [];
const hotbar = Array(HOTBAR_SIZE).fill(null);
const secondaryHotbar = Array(HOTBAR_SIZE).fill(null);
let draggedPetal = null;
let viewportWidth = window.innerWidth;
let viewportHeight = window.innerHeight;
let lastTime = performance.now();
let frameDelta = 1 / 60;
let expandHeld = false;
let retractHeld = false;
let wasDead = false;
let inventoryAnimationIndex = null;
let equippedAnimationTarget = null;
let activeTooltip = null;
let pendingSwapAnimation = null;

function createPetal(petalId, rarityId) {
  return { petalId, rarityId };
}

function getPetalStats(petal) {
  const type = PETAL_TYPES[petal.petalId];
  const rarity = rarityById.get(petal.rarityId);
  return {
    ...type,
    ...rarity,
    petalName: type.label,
    rarityLabel: rarity.label,
    damage: type.baseDamage * rarity.multiplier,
    health: type.baseHealth * rarity.multiplier,
    reload: type.baseReload,
  };
}

function addToInventory(petal, count = 1) {
  const stack = inventory.find((entry) => entry.petalId === petal.petalId && entry.rarityId === petal.rarityId);
  if (stack) stack.count += count;
  else inventory.push({ ...petal, count });
}

function getBar(kind) {
  return kind === 'secondary-hotbar' ? secondaryHotbar : hotbar;
}

PETAL_RARITIES.forEach((rarity, index) => {
  const rarityId = rarity.id;
  hotbar[index] = createPetal(1, rarityId);
  addToInventory(createPetal(1, rarityId), 5);
});

grassTexture.src = 'assets/grasstexture.webp';
grassTexture.addEventListener('load', () => {
  grassPattern = context.createPattern(grassTexture, 'repeat');
});
borderTexture.addEventListener('load', () => {
  borderPattern = context.createPattern(borderTexture, 'repeat');
});
borderTexture.src = 'assets/bordertexture.svg';
const mobImage = new Image();
let mobSprite = null;
mobImage.addEventListener('load', () => {
  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = mobImage.naturalWidth;
  spriteCanvas.height = mobImage.naturalHeight;
  const spriteContext = spriteCanvas.getContext('2d');
  spriteContext.drawImage(mobImage, 0, 0);
  const pixels = spriteContext.getImageData(0, 0, spriteCanvas.width, spriteCanvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (pixels.data[index] > 242 && pixels.data[index + 1] > 242 && pixels.data[index + 2] > 242) {
      pixels.data[index + 3] = 0;
    }
  }
  spriteContext.putImageData(pixels, 0, 0);
  mobSprite = spriteCanvas;
});
mobImage.src = 'assets/Rock.webp';

function resize() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  viewportWidth = window.innerWidth;
  viewportHeight = window.innerHeight;
  canvas.width = Math.floor(viewportWidth * pixelRatio);
  canvas.height = Math.floor(viewportHeight * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  minimapCanvas.width = 400;
  minimapCanvas.height = 400;
}

function drawWorld() {
  context.fillStyle = '#6a4127';
  context.fillRect(0, 0, viewportWidth, viewportHeight);

  const worldLeft = Math.floor(viewportWidth / 2 - camera.x);
  const worldTop = Math.floor(viewportHeight / 2 - camera.y);
  const mapLeft = worldLeft + WORLD.border;
  const mapTop = worldTop + WORLD.border;
  const mapRight = worldLeft + WORLD.width - WORLD.border;
  const mapBottom = worldTop + WORLD.height - WORLD.border;

  if (borderPattern) {
    context.save();
    borderPattern.setTransform(
      new DOMMatrix().translate(worldLeft, worldTop).scale(borderTextureScale),
    );
    context.fillStyle = borderPattern;
    context.fillRect(worldLeft, worldTop, WORLD.width, WORLD.height);
    context.restore();
  }

  const mapWidth = mapRight - mapLeft;
  const mapHeight = mapBottom - mapTop;
  if (grassPattern) {
    context.save();
    grassPattern.setTransform(
      new DOMMatrix().translate(mapLeft, mapTop).scale(grassTextureScale),
    );
    context.fillStyle = grassPattern;
    context.fillRect(mapLeft, mapTop, mapWidth, mapHeight);
    context.restore();
  } else {
    context.fillStyle = '#76a943';
    context.fillRect(mapLeft, mapTop, mapWidth, mapHeight);
  }
  context.strokeStyle = 'rgba(42, 68, 27, 0.58)';
  context.lineWidth = 4;
  context.strokeRect(mapLeft + 1, mapTop + 1, mapRight - mapLeft - 2, mapBottom - mapTop - 2);

  drawMobs(worldLeft, worldTop);

  remotePlayers.forEach((remotePlayer) => {
    remotePlayer.renderX += (remotePlayer.x - remotePlayer.renderX) * (1 - Math.exp(-14 * frameDelta));
    remotePlayer.renderY += (remotePlayer.y - remotePlayer.renderY) * (1 - Math.exp(-14 * frameDelta));
    drawOrbitingPetals(worldLeft + remotePlayer.renderX, worldTop + remotePlayer.renderY, remotePlayer.hotbar, remotePlayer.id, remotePlayer, 'hotbar');
    drawPlayer(worldLeft + remotePlayer.renderX, worldTop + remotePlayer.renderY, remotePlayer.username, remotePlayer);
    if (remotePlayer.respawnFade) {
      const fadeProgress = (performance.now() - remotePlayer.respawnFade.startedAt) / 460;
      if (fadeProgress >= 1) {
        remotePlayer.respawnFade = null;
      } else {
        drawPlayer(
          worldLeft + remotePlayer.respawnFade.x,
          worldTop + remotePlayer.respawnFade.y,
          remotePlayer.username,
          { radius: remotePlayer.radius || 31, health: 0 },
          1 - fadeProgress,
        );
      }
    }
  });
  player.renderX = player.x;
  player.renderY = player.y;
  player.expandHeld = expandHeld;
  player.retractHeld = retractHeld;
  drawOrbitingPetals(worldLeft + player.x, worldTop + player.y, hotbar, localPlayerId, player, 'hotbar');
  drawPlayer(worldLeft + player.x, worldTop + player.y, selectedUsername, player);
}

function drawMobs(worldLeft, worldTop) {
  mobs.forEach((mob) => {
    if (!mobSprite || mob.health <= 0) return;
    mob.renderX += (mob.x - mob.renderX) * (1 - Math.exp(-12 * frameDelta));
    mob.renderY += (mob.y - mob.renderY) * (1 - Math.exp(-12 * frameDelta));
    const size = mob.size;
    context.save();
    context.globalAlpha = 0.98;
    context.drawImage(mobSprite, worldLeft + mob.renderX - size / 2, worldTop + mob.renderY - size / 2, size, size);
    context.restore();
    const healthWidth = Math.min(180, Math.max(70, size * 0.55));
    const screenX = worldLeft + mob.renderX;
    const labelY = worldTop + mob.renderY + size / 2 + 16;
    context.fillStyle = 'rgba(38, 20, 14, 0.78)';
    context.fillRect(screenX - healthWidth / 2, labelY + 16, healthWidth, 7);
    context.fillStyle = '#ed5b75';
    context.fillRect(screenX - healthWidth / 2, labelY + 16, healthWidth * Math.max(0, mob.health / mob.maxHealth), 7);
    context.fillStyle = '#fff8dc';
    context.font = '800 12px Nunito, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(`${mob.rarityId} ${mob.name || 'Rock'}`, screenX, labelY);
    context.font = '700 10px Nunito, sans-serif';
    context.fillText(`${Math.ceil(mob.health)} / ${Math.ceil(mob.maxHealth)}`, screenX, labelY + 25);
  });
}

function connectToServer() {
  socket = new WebSocket(SERVER_URL);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'start', username: selectedUsername }));
    console.info('Connected to Meadow IO server.');
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === 'welcome') {
      localPlayerId = message.playerId;
      remotePlayers.clear();
      message.players
        .filter((remotePlayer) => remotePlayer.id !== localPlayerId)
        .forEach((remotePlayer) => {
          remotePlayer.renderX = remotePlayer.x;
          remotePlayer.renderY = remotePlayer.y;
          remotePlayers.set(remotePlayer.id, remotePlayer);
        });
    }
    if (message.type === 'state') {
      PETAL_RARITIES = message.petalRarities;
      PETAL_TYPES = message.petalTypes;
      rarityById = new Map(PETAL_RARITIES.map((rarity) => [rarity.id, rarity]));
      updateMobState(message.mobs || []);
      player.x = message.player.x;
      player.y = message.player.y;
      player.authoritativeX = message.player.x;
      player.authoritativeY = message.player.y;
      player.authoritativeVelocityX = message.player.velocityX || 0;
      player.authoritativeVelocityY = message.player.velocityY || 0;
      player.renderX = player.renderX || player.x;
      player.renderY = player.renderY || player.y;
      player.health = message.player.health;
      player.maxHealth = message.player.maxHealth;
      player.bodyDamage = message.player.bodyDamage;
      player.damage = message.player.damage;
      player.reload = message.player.reload;
      player.petalHealth = message.player.petalHealth;
      player.petalReloads = message.player.petalReloads;
      player.secondaryPetalHealth = message.player.secondaryPetalHealth;
      player.secondaryPetalReloads = message.player.secondaryPetalReloads;
      updateHotbarReloadUi();
      updateDeathState();
      inventory.splice(0, inventory.length, ...message.inventory);
      hotbar.splice(0, hotbar.length, ...message.hotbar);
      secondaryHotbar.splice(0, secondaryHotbar.length, ...message.secondaryHotbar);
      renderPetalUi();
    }
    if (message.type === 'petalEquipped') {
      equippedAnimationTarget = message;
    }
    if (message.type === 'playerJoined' && message.player.id !== localPlayerId) {
      message.player.renderX = message.player.x;
      message.player.renderY = message.player.y;
      remotePlayers.set(message.player.id, message.player);
    }
    if (message.type === 'worldUpdated') {
      message.players.forEach(applyNetworkPlayerUpdate);
      updateMobState(message.mobs || []);
    }
    if (message.type === 'playerLeft') {
      remotePlayers.delete(message.playerId);
    }
    if (message.type === 'chat' && typeof message.username === 'string' && typeof message.text === 'string') {
      appendChatMessage(message.username, message.text);
    }
  });

  socket.addEventListener('close', () => {
    localPlayerId = null;
    remotePlayers.clear();
    if (hasStartedGame) window.setTimeout(connectToServer, 3000);
  }, { once: true });
}

function updateMobState(networkMobs) {
  networkMobs.forEach((networkMob) => {
    const existing = mobs.get(networkMob.id) || networkMob;
    existing.renderX = existing.renderX ?? networkMob.x;
    existing.renderY = existing.renderY ?? networkMob.y;
    Object.assign(existing, networkMob);
    mobs.set(networkMob.id, existing);
  });
}

function sendPlayerPosition(force = false) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (!force && networkSendTimer < 0.05) return;
  networkSendTimer = 0;
  const input = {
    x: (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0),
    y: (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0),
  };
  socket.send(JSON.stringify({ type: 'input', ...input }));
}

function applyNetworkPlayerUpdate(networkPlayer) {
  if (networkPlayer.id === localPlayerId) {
    player.authoritativeX = networkPlayer.x;
    player.authoritativeY = networkPlayer.y;
    player.authoritativeVelocityX = networkPlayer.velocityX || 0;
    player.authoritativeVelocityY = networkPlayer.velocityY || 0;
    player.health = networkPlayer.health;
    player.maxHealth = networkPlayer.maxHealth;
    player.bodyDamage = networkPlayer.bodyDamage;
    player.damage = networkPlayer.damage;
    player.reload = networkPlayer.reload;
    markReloadedPetals(player, networkPlayer.petalReloads, networkPlayer.secondaryPetalReloads);
    player.petalHealth = networkPlayer.petalHealth;
    player.petalReloads = networkPlayer.petalReloads;
    player.secondaryPetalHealth = networkPlayer.secondaryPetalHealth;
    player.secondaryPetalReloads = networkPlayer.secondaryPetalReloads;
    updateHotbarReloadUi();
    updateDeathState();
    return;
  }

  const existing = remotePlayers.get(networkPlayer.id) || networkPlayer;
  const wasDead = existing.health <= 0;
  const previousRenderX = existing.renderX ?? existing.x;
  const previousRenderY = existing.renderY ?? existing.y;
  markReloadedPetals(existing, networkPlayer.petalReloads, networkPlayer.secondaryPetalReloads);
  Object.assign(existing, networkPlayer);
  if (wasDead && existing.health > 0) {
    existing.respawnFade = {
      x: previousRenderX,
      y: previousRenderY,
      startedAt: performance.now(),
    };
  }
  remotePlayers.set(networkPlayer.id, existing);
}

function markReloadedPetals(state, nextMainReloads = [], nextSecondaryReloads = []) {
  if (!state.reloadAnimations) state.reloadAnimations = new Map();
  const previousMain = state.petalReloads || [];
  const previousSecondary = state.secondaryPetalReloads || [];
  [
    ['hotbar', previousMain, nextMainReloads],
    ['secondary-hotbar', previousSecondary, nextSecondaryReloads],
  ].forEach(([barName, previous, next]) => {
    next.forEach((remaining, slot) => {
      if ((previous[slot] || 0) > 0 && remaining === 0) {
        state.reloadAnimations.set(`${barName}:${slot}`, performance.now());
      }
    });
  });
}

function sendServerAction(action, data = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type: 'action', action, ...data }));
  return true;
}

function updateDeathState() {
  const isDead = player.health <= 0;
  if (isDead === wasDead) return;
  wasDead = isDead;
  deathOverlay.hidden = !isDead;
  if (isDead) {
    expandHeld = false;
    retractHeld = false;
    sendPetalControl();
  }
}

function sendPetalControl() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'petalControl', expandHeld, retractHeld }));
}

function toggleChat(isOpen = chatPanel.hidden) {
  chatPanel.hidden = !isOpen;
  if (isOpen) chatInput.focus();
}

function appendChatMessage(username, text) {
  const message = document.createElement('p');
  const name = document.createElement('strong');
  name.textContent = `${username}:`;
  message.append(name, ` ${text}`);
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function drawOrbitingPetals(screenX, screenY, equippedBar = hotbar, orbitId = 'local', orbitState = {}) {
  orbitState.currentBarName = orbitState.currentBarName || 'hotbar';
  if (orbitState.health <= 0) return;
  const equippedPetals = equippedBar
    .map((petal, slot) => ({ petal, slot }))
    .filter(({ petal, slot }) => petal && (!orbitState.petalHealth || orbitState.petalHealth[slot] > 0));
  const defaultRadius = 86;
  const expandedRadius = 145;
  const retractedRadius = 46;
  const targetRadius = orbitState.expandHeld ? expandedRadius : orbitState.retractHeld ? retractedRadius : defaultRadius;
  orbitState.orbitRadius = (orbitState.orbitRadius ?? defaultRadius)
    + (targetRadius - (orbitState.orbitRadius ?? defaultRadius)) * (1 - Math.exp(-10 * frameDelta));
  if (!equippedPetals.length) return;

  const phase = orbitId ? orbitId.length * 0.17 : 0;
  const rotation = ((performance.now() % PETAL_ROTATION_MS) / PETAL_ROTATION_MS * Math.PI * 2) + phase;
  equippedPetals.forEach((petal, index) => {
    const angle = rotation + index / equippedPetals.length * Math.PI * 2;
    const animationKey = `${orbitState.currentBarName || 'hotbar'}:${petal.slot}`;
    const animationStartedAt = orbitState.reloadAnimations?.get(animationKey);
    const animationProgress = animationStartedAt ? Math.min(1, (performance.now() - animationStartedAt) / 520) : 1;
    if (animationProgress >= 1 && animationStartedAt) orbitState.reloadAnimations.delete(animationKey);
    const easedProgress = 1 - Math.pow(1 - animationProgress, 3);
    drawPetal(
      screenX + Math.cos(angle) * orbitState.orbitRadius,
      screenY + Math.sin(angle) * orbitState.orbitRadius,
      getPetalStats(petal.petal),
      angle + Math.PI / 2,
      21,
      0.12 + easedProgress * 0.88,
      0.2 + easedProgress * 0.8,
    );
  });
}

function drawPetal(screenX, screenY, rarity, rotation, size, opacity = 1, scale = 1) {
  context.save();
  context.translate(screenX, screenY);
  context.rotate(rotation);
  context.scale(scale, scale);
  context.globalAlpha = opacity;
  context.shadowColor = 'rgba(30, 19, 12, 0.4)';
  context.shadowBlur = 7;
  context.shadowOffsetY = 3;
  context.fillStyle = '#fff';
  context.strokeStyle = 'rgba(60, 36, 21, 0.7)';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(0, 0, size * 0.72, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawPlayer(screenX, screenY, username = '', playerState = player, opacity = 1) {
  const pulse = Math.sin(performance.now() / 240) * 0.8;
  const radius = playerState.radius + pulse;

  context.save();
  context.globalAlpha = opacity;
  context.translate(screenX, screenY);
  context.shadowColor = 'rgba(21, 42, 13, 0.35)';
  context.shadowBlur = 8;
  context.shadowOffsetY = 4;

  context.fillStyle = '#f1bd32';
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  context.shadowColor = 'transparent';
  context.strokeStyle = '#b4771d';
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = '#fffaf0';
  context.beginPath();
  context.arc(-11, -8, 8.4, 0, Math.PI * 2);
  context.arc(11, -8, 8.4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#382a20';
  context.lineWidth = 3;
  context.lineCap = 'round';
  if (playerState.health <= 0) {
    context.strokeStyle = '#382a20';
    context.beginPath();
    context.moveTo(-15, -12);
    context.lineTo(-5, -2);
    context.moveTo(-5, -12);
    context.lineTo(-15, -2);
    context.moveTo(5, -12);
    context.lineTo(15, -2);
    context.moveTo(15, -12);
    context.lineTo(5, -2);
    context.stroke();
  } else {
    context.beginPath();
    context.arc(-10, -7, 3.6, 0, Math.PI * 2);
    context.arc(10, -7, 3.6, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = '#382a20';
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.beginPath();
  if (playerState.health <= 0) {
    context.moveTo(-9, 10);
    context.lineTo(9, 10);
  } else {
    context.arc(0, 2, 12, 0.25, Math.PI - 0.25);
  }
  context.stroke();
  if (username) {
    context.shadowColor = 'transparent';
    context.fillStyle = '#fff8dc';
    context.font = '800 14px Nunito, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(username, 0, radius + 10);
    if (playerState.health > 0) {
      const maxHealth = Math.max(1, playerState.maxHealth || 100);
      const health = Math.max(0, Math.min(maxHealth, playerState.health ?? maxHealth));
      const healthWidth = 76;
      const healthTop = radius + 29;
      context.fillStyle = 'rgba(38, 20, 14, 0.78)';
      context.fillRect(-healthWidth / 2, healthTop, healthWidth, 6);
      context.fillStyle = health > maxHealth * 0.35 ? '#55c878' : '#ed5b75';
      context.fillRect(-healthWidth / 2, healthTop, healthWidth * (health / maxHealth), 6);
      context.strokeStyle = 'rgba(255, 248, 220, 0.7)';
      context.lineWidth = 1;
      context.strokeRect(-healthWidth / 2, healthTop, healthWidth, 6);
      context.fillStyle = '#fff8dc';
      context.font = '700 10px Nunito, sans-serif';
      context.fillText(`${Math.ceil(health)} / ${Math.ceil(maxHealth)}`, 0, healthTop + 8);
    }
  }
  context.restore();
}

function drawMinimap() {
  const size = minimapCanvas.width;
  const scale = size / WORLD.width;
  minimapContext.clearRect(0, 0, size, size);
  minimapContext.fillStyle = '#694027';
  minimapContext.fillRect(0, 0, size, size);

  const mapStart = WORLD.border * scale;
  const mapSize = (WORLD.width - WORLD.border * 2) * scale;
  minimapContext.fillStyle = '#cbd0c6';
  minimapContext.fillRect(mapStart, mapStart, mapSize, mapSize);

  minimapContext.strokeStyle = 'rgba(79, 48, 28, 0.75)';
  minimapContext.lineWidth = 3;
  minimapContext.strokeRect(mapStart, mapStart, mapSize, mapSize);

  minimapContext.fillStyle = '#4bba62';
  minimapContext.beginPath();
  minimapContext.arc(player.x * scale, player.y * scale, 6, 0, Math.PI * 2);
  minimapContext.fill();
  minimapContext.strokeStyle = '#205c32';
  minimapContext.lineWidth = 2;
  minimapContext.stroke();
}

function showPetalTooltip(slot, petal) {
  hidePetalTooltip();
  const stats = getPetalStats(petal);
  const tooltip = document.createElement('div');
  tooltip.className = 'petal-tooltip';
  tooltip.style.setProperty('--tooltip-color', stats.color);
  tooltip.innerHTML = `<strong>${stats.petalName} Petal</strong><br>${stats.rarityLabel}<br>Damage: ${stats.damage}<br>Health: ${stats.health}<br>Reload: ${stats.reload}s`;
  document.body.append(tooltip);
  const bounds = slot.getBoundingClientRect();
  tooltip.style.left = `${bounds.left + bounds.width / 2}px`;
  tooltip.style.top = `${bounds.top}px`;
  slot._tooltip = tooltip;
  activeTooltip = tooltip;
}

function hidePetalTooltip(slot = null) {
  if (slot && slot._tooltip !== activeTooltip) {
    slot._tooltip = null;
    return;
  }
  if (slot?._tooltip) slot._tooltip = null;
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
}

document.addEventListener('pointermove', (event) => {
  if (activeTooltip && !event.target.closest?.('.petal-slot')) hidePetalTooltip();
});
window.addEventListener('blur', () => hidePetalTooltip());

function createPetalDragPreview(petal) {
  const stats = getPetalStats(petal);
  const preview = document.createElement('canvas');
  const previewContext = preview.getContext('2d');
  preview.width = 88;
  preview.height = 88;
  previewContext.fillStyle = stats.color;
  previewContext.fillRect(2, 2, 84, 84);
  previewContext.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  previewContext.lineWidth = 2;
  previewContext.strokeRect(2, 2, 84, 84);
  previewContext.fillStyle = stats.color;
  previewContext.fillStyle = '#fff';
  previewContext.strokeStyle = 'rgba(65, 65, 65, 0.45)';
  previewContext.lineWidth = 2;
  previewContext.beginPath();
  previewContext.arc(44, 44, 22, 0, Math.PI * 2);
  previewContext.fill();
  previewContext.stroke();
  return preview;
}

function createDragFadeGhost(slot, petal) {
  if (!slot) return;
  const bounds = slot.getBoundingClientRect();
  const ghost = slot.cloneNode(true);
  ghost.classList.remove('is-reloading', 'is-swapping');
  ghost.classList.add('petal-drag-fade');
  ghost.style.left = `${bounds.left}px`;
  ghost.style.top = `${bounds.top}px`;
  ghost.style.width = `${bounds.width}px`;
  ghost.style.height = `${bounds.height}px`;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('data-kind');
  ghost.removeAttribute('data-index');
  document.body.append(ghost);
  window.setTimeout(() => ghost.remove(), 460);
}

function createPetalSlot(kind, index, petal) {
  const slot = document.createElement('button');
  const stats = petal ? getPetalStats(petal) : null;
  const rarity = stats;
  const reloadBar = kind === 'secondary-hotbar' ? player.secondaryPetalReloads : player.petalReloads;
  const reloadRemaining = kind === 'inventory' ? 0 : (reloadBar?.[index] || 0);
  slot.type = 'button';
  slot.className = `petal-slot${rarity ? ` rarity-${rarity.id}` : ' empty'}${reloadRemaining > 0 ? ' reloading' : ''}`;
  slot.dataset.kind = kind;
  slot.dataset.index = index;
  slot.dataset.slotNumber = index === 9 ? '0' : String(index + 1);
  slot.title = rarity
    ? `${stats.petalName} petal | ${stats.rarityLabel} | Damage ${stats.damage} | Health ${stats.health} | Reload ${stats.reload}s${reloadRemaining > 0 ? ` | Ready in ${reloadRemaining.toFixed(1)}s` : ''}`
    : 'Empty petal slot';

  if (rarity) {
    slot.draggable = true;
    slot.innerHTML = `<span class="petal-icon basic"></span><span class="petal-name">${stats.petalName}</span>`;
    if (reloadRemaining > 0) {
      slot.innerHTML += `<span class="petal-reload-overlay" aria-hidden="true"></span><span class="petal-reload-time">${reloadRemaining.toFixed(1)}</span>`;
    }
    if (kind === 'inventory') {
      slot.innerHTML += `<span class="petal-count">x${inventory[index].count}</span>`;
    }
    slot.addEventListener('dragstart', (event) => {
      draggedPetal = { kind, index, petal };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify(draggedPetal));
      event.dataTransfer.setDragImage(createPetalDragPreview(petal), 32, 32);
    });
    slot.addEventListener('dragend', () => {
      draggedPetal = null;
    });
    slot.addEventListener('mouseenter', () => showPetalTooltip(slot, petal));
    slot.addEventListener('mouseleave', () => hidePetalTooltip(slot));
    slot.addEventListener('pointerleave', () => hidePetalTooltip(slot));
    if (kind === 'inventory') {
      slot.addEventListener('click', () => {
        inventoryAnimationIndex = index;
        slot.classList.add('is-equipping');
        sendServerAction('equipNext', { inventoryIndex: index });
      });
    }
  }
  slot.innerHTML += `<span class="slot-number">${slot.dataset.slotNumber}</span>`;

  slot.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  slot.addEventListener('drop', (event) => {
    event.preventDefault();
    handlePetalDrop(kind, index);
  });
  slot.addEventListener('contextmenu', (event) => {
    const bar = getBar(kind);
    if (!bar[index]) return;
    event.preventDefault();
    sendServerAction('store', { sourceBar: kind, sourceSlot: index });
  });
  return slot;
}

function updateReloadBarUi(container, reloads) {
  container.querySelectorAll('.petal-slot').forEach((slot) => {
    const index = Number(slot.dataset.index);
    const remaining = reloads?.[index] || 0;
    slot.classList.toggle('reloading', remaining > 0);
    let overlay = slot.querySelector('.petal-reload-overlay');
    let time = slot.querySelector('.petal-reload-time');
    if (remaining > 0) {
      if (!overlay) {
        overlay = document.createElement('span');
        overlay.className = 'petal-reload-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        slot.append(overlay);
      }
      if (!time) {
        time = document.createElement('span');
        time.className = 'petal-reload-time';
        time.setAttribute('aria-hidden', 'true');
        slot.append(time);
      }
      time.textContent = remaining.toFixed(1);
    } else {
      overlay?.remove();
      time?.remove();
    }
  });
}

function updateHotbarReloadUi() {
  updateReloadBarUi(hotbarSlots, player.petalReloads);
  updateReloadBarUi(secondaryHotbarSlots, player.secondaryPetalReloads);
}

function handlePetalDrop(targetKind, targetIndex) {
  if (!draggedPetal) return;
  const sourcePetal = draggedPetal.petal;

  if (targetKind === 'inventory') {
    if (draggedPetal.kind === 'hotbar' || draggedPetal.kind === 'secondary-hotbar') {
      sendServerAction('store', {
        sourceBar: draggedPetal.kind,
        sourceSlot: draggedPetal.index,
      });
    }
    return;
  }

  const targetBar = getBar(targetKind);
  if (draggedPetal.kind === 'inventory') {
    if (targetBar[targetIndex]) return;
    sendServerAction('equip', {
      inventoryIndex: draggedPetal.index,
      targetBar: targetKind,
      targetSlot: targetIndex,
    });
  } else if (draggedPetal.kind === 'hotbar' || draggedPetal.kind === 'secondary-hotbar') {
    pendingSwapAnimation = {
      sourceBar: draggedPetal.kind,
      sourceSlot: draggedPetal.index,
      targetBar: targetKind,
      targetSlot: targetIndex,
    };
    sendServerAction('swapSlots', {
      sourceBar: draggedPetal.kind,
      sourceSlot: draggedPetal.index,
      targetBar: targetKind,
      targetSlot: targetIndex,
    });
  }
}

document.addEventListener('dragover', (event) => {
  if (!draggedPetal) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
});

document.addEventListener('drop', (event) => {
  if (!draggedPetal || !['hotbar', 'secondary-hotbar'].includes(draggedPetal.kind)) return;
  if (event.target.closest('.petal-slot')) return;
  event.preventDefault();
  const sourceSlot = document.querySelector(`[data-kind="${draggedPetal.kind}"][data-index="${draggedPetal.index}"]`);
  createDragFadeGhost(sourceSlot, draggedPetal.petal);
  sendServerAction('store', {
    sourceBar: draggedPetal.kind,
    sourceSlot: draggedPetal.index,
  });
  draggedPetal = null;
});

function renderPetalUi() {
  hidePetalTooltip();
  inventoryGrid.replaceChildren();
  [...PETAL_RARITIES].reverse().forEach((rarity) => {
    const stacks = inventory.filter((entry) => entry.rarityId === rarity.id);
    if (!stacks.length) return;
    const label = document.createElement('div');
    label.className = 'inventory-rarity-label';
    label.textContent = rarity.label;
    inventoryGrid.append(label);
    stacks.forEach((petal, index) => inventoryGrid.append(createPetalSlot('inventory', inventory.indexOf(petal), petal)));
  });

  hotbarSlots.replaceChildren();
  hotbar.forEach((petal, index) => {
    hotbarSlots.append(createPetalSlot('hotbar', index, petal));
  });
  secondaryHotbarSlots.replaceChildren();
  secondaryHotbar.forEach((petal, index) => {
    secondaryHotbarSlots.append(createPetalSlot('secondary-hotbar', index, petal));
  });
  if (inventoryAnimationIndex !== null) {
    const inventorySlot = inventoryGrid.querySelector(`[data-kind="inventory"][data-index="${inventoryAnimationIndex}"]`);
    inventorySlot?.classList.add('is-equipping');
    inventoryAnimationIndex = null;
  }
  if (equippedAnimationTarget) {
    const bar = equippedAnimationTarget.targetBar === 'hotbar' ? hotbarSlots : secondaryHotbarSlots;
    const targetSlot = bar.querySelector(`[data-kind="${equippedAnimationTarget.targetBar}"][data-index="${equippedAnimationTarget.targetSlot}"]`);
    targetSlot?.classList.add('is-equipped');
    equippedAnimationTarget = null;
  }
  if (pendingSwapAnimation) {
    const sourceContainer = pendingSwapAnimation.sourceBar === 'hotbar' ? hotbarSlots : secondaryHotbarSlots;
    const targetContainer = pendingSwapAnimation.targetBar === 'hotbar' ? hotbarSlots : secondaryHotbarSlots;
    sourceContainer.querySelector(`[data-kind="${pendingSwapAnimation.sourceBar}"][data-index="${pendingSwapAnimation.sourceSlot}"]`)
      ?.classList.add('is-swap-source');
    targetContainer.querySelector(`[data-kind="${pendingSwapAnimation.targetBar}"][data-index="${pendingSwapAnimation.targetSlot}"]`)
      ?.classList.add('is-swap-target');
    pendingSwapAnimation = null;
  }
}

function toggleInventory(isOpen = inventoryPanel.hidden) {
  inventoryPanel.hidden = !isOpen;
  inventoryButton.setAttribute('aria-expanded', String(isOpen));
}

inventoryGrid.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
});
inventoryGrid.addEventListener('drop', (event) => {
  event.preventDefault();
  if (!draggedPetal || !['hotbar', 'secondary-hotbar'].includes(draggedPetal.kind)) return;
  sendServerAction('store', {
    sourceBar: draggedPetal.kind,
    sourceSlot: draggedPetal.index,
  });
  draggedPetal = null;
});

function swapHotbarSlot(slotIndex) {
  sendServerAction('swapBars', { slot: slotIndex });
}

function movePlayer(deltaTime) {
  networkSendTimer += deltaTime;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (player.health <= 0) {
    player.velocityX = 0;
    player.velocityY = 0;
    camera.x = player.x;
    camera.y = player.y;
    return;
  }
  sendPlayerPosition();

  const horizontal = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0)
    - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
  const vertical = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0)
    - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
  const inputLength = Math.hypot(horizontal, vertical) || 1;
  const targetVelocityX = horizontal / inputLength * player.speed;
  const targetVelocityY = vertical / inputLength * player.speed;
  const velocityStep = (horizontal || vertical ? MOVEMENT_ACCELERATION : MOVEMENT_DECELERATION) * deltaTime;
  player.velocityX += Math.max(-velocityStep, Math.min(velocityStep, targetVelocityX - player.velocityX));
  player.velocityY += Math.max(-velocityStep, Math.min(velocityStep, targetVelocityY - player.velocityY));
  player.x += player.velocityX * deltaTime;
  player.y += player.velocityY * deltaTime;

  const minPosition = WORLD.border + player.radius;
  const maxPosition = WORLD.width - WORLD.border - player.radius;
  player.x = Math.max(minPosition, Math.min(maxPosition, player.x));
  player.y = Math.max(minPosition, Math.min(maxPosition, player.y));

  const correctionStrength = 1 - Math.exp(-10 * deltaTime);
  const errorX = player.authoritativeX - player.x;
  const errorY = player.authoritativeY - player.y;
  const error = Math.hypot(errorX, errorY);
  if (error > 70 || (!horizontal && !vertical)) {
    const correctionScale = error > 70 ? correctionStrength : correctionStrength * 0.35;
    player.x += errorX * correctionScale;
    player.y += errorY * correctionScale;
  }
  camera.x = player.x;
  camera.y = player.y;
}

function gameLoop(currentTime) {
  const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.05);
  lastTime = currentTime;
  frameDelta = deltaTime;
  movePlayer(deltaTime);
  drawWorld();
  drawMinimap();
  requestAnimationFrame(gameLoop);
}

window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !chatPanel.hidden) {
    event.preventDefault();
    toggleChat(false);
    return;
  }
  if (event.target === chatInput) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (text && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'chat', text }));
        chatInput.value = '';
        toggleChat(false);
      }
    }
    return;
  }
  if (event.key === 'Enter' && hasStartedGame) {
    event.preventDefault();
    toggleChat(true);
    return;
  }
  if (event.key.toLowerCase() === 'x' && hasStartedGame) {
    event.preventDefault();
    toggleInventory();
    return;
  }
  if (event.key.toLowerCase() === 'r' && hasStartedGame) {
    event.preventDefault();
    sendServerAction('swapAllBars');
    return;
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) {
    event.preventDefault();
  }
  if (event.key === ' ') {
    expandHeld = true;
    sendPetalControl();
  }
  if (event.key === 'Shift') {
    retractHeld = true;
    sendPetalControl();
  }
  if (/^[0-9]$/.test(event.key)) {
    const slotIndex = event.key === '0' ? 9 : Number(event.key) - 1;
    swapHotbarSlot(slotIndex);
    event.preventDefault();
  }
  keys.add(key);
  sendPlayerPosition(true);
});
window.addEventListener('keyup', (event) => {
  if (event.target === chatInput) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.key === ' ') {
    expandHeld = false;
    sendPetalControl();
  }
  if (event.key === 'Shift') {
    retractHeld = false;
    sendPetalControl();
  }
  keys.delete(key);
  sendPlayerPosition(true);
});

canvas.addEventListener('mousedown', (event) => {
  if (event.button === 0) expandHeld = true;
  if (event.button === 2) retractHeld = true;
  sendPetalControl();
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 0) expandHeld = false;
  if (event.button === 2) retractHeld = false;
  sendPetalControl();
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('blur', () => {
  expandHeld = false;
  retractHeld = false;
  sendPetalControl();
});

inventoryButton.addEventListener('click', () => toggleInventory());
inventoryClose.addEventListener('click', () => toggleInventory(false));
respawnButton.addEventListener('click', () => sendServerAction('respawn'));
playForm.addEventListener('submit', (event) => {
  event.preventDefault();
  selectedUsername = usernameInput.value.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'Guest';
  hasStartedGame = true;
  homeScreen.hidden = true;
  gameShell.hidden = false;
  connectToServer();
});
renderPetalUi();

resize();
requestAnimationFrame(gameLoop);
