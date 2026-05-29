/**
 * Canvas 图片解码器
 * 在 Canvas 上加载图片 → 提取像素 → 纯前端解析条码/二维码
 * 不调用 wx.scanCode，避免弹出原生扫码界面
 */

/**
 * 对指定图片路径进行条码/二维码识别
 * @param {string} imagePath - 图片文件路径
 * @param {Object} options
 * @param {Function} options.onSuccess - 成功回调 (result, scanType)
 * @param {Function} options.onFail - 失败回调 (errMsg)
 */
function decodeFromImage(imagePath, options = {}) {
  const { onSuccess, onFail } = options;

  wx.getImageInfo({
    src: imagePath,
    success: (imgInfo) => {
      processImage(imgInfo, onSuccess, onFail);
    },
    fail: () => {
      // getImageInfo 失败，回退到原生 scanCode
      fallbackToScanCode(imagePath, onSuccess, onFail);
    }
  });
}

/**
 * 在 Canvas 上处理图片并尝试解码
 */
function processImage(imgInfo, onSuccess, onFail) {
  const maxWidth = 800; // 限制 Canvas 宽度，避免内存过大
  let canvasW = imgInfo.width;
  let canvasH = imgInfo.height;

  if (canvasW > maxWidth) {
    const ratio = maxWidth / canvasW;
    canvasW = maxWidth;
    canvasH = Math.round(canvasH * ratio);
  }

  const query = wx.createSelectorQuery();
  query.select('#decode-canvas')
    .fields({ node: true, size: true })
    .exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        // Canvas 节点不存在，回退
        fallbackToScanCode(imgInfo.path, onSuccess, onFail);
        return;
      }

      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getWindowInfo().pixelRatio;
      canvas.width = canvasW * dpr;
      canvas.height = canvasH * dpr;
      ctx.scale(dpr, dpr);

      // 绘制图片
      const img = canvas.createImage();
      img.onload = () => {
        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.drawImage(img, 0, 0, canvasW, canvasH);

        try {
          // 获取像素数据 - 简化采样
          const sampleRate = Math.max(1, Math.floor(Math.min(canvasW, canvasH) / 500));
          const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
          const pixels = imageData.data;
          const w = canvasW;
          const h = canvasH;

          // 尝试 QR 码解码
          const qrResult = decodeQRCode(pixels, w, h, sampleRate);
          if (qrResult) {
            onSuccess && onSuccess(qrResult.result, qrResult.scanType || 'QR_CODE');
            return;
          }

          // 尝试一维条码解码
          const barcodeResult = decodeBarcode(pixels, w, h, sampleRate);
          if (barcodeResult) {
            onSuccess && onSuccess(barcodeResult.result, barcodeResult.scanType || 'BAR_CODE');
            return;
          }

          // JS 解码均失败，回退原生
          fallbackToScanCode(imgInfo.path, onSuccess, onFail);
        } catch (e) {
          console.error('Canvas decode error:', e);
          fallbackToScanCode(imgInfo.path, onSuccess, onFail);
        }
      };
      img.onerror = () => {
        fallbackToScanCode(imgInfo.path, onSuccess, onFail);
      };
      img.src = imgInfo.path;
    });
}

// ============ QR 码解码 ============

/**
 * 简化的二维码解码
 * 检测 Finder Pattern（识别图案） → 定位 → 读取模块
 */
function decodeQRCode(pixels, w, h, sampleRate) {
  const gray = toGrayMatrix(pixels, w, h, sampleRate);
  const gw = gray[0].length;
  const gh = gray.length;

  // 扫描 Finder Patterns（1:1:3:1:1 比率）
  const finders = findFinderPatterns(gray, gw, gh);
  if (finders.length < 3) return null;

  // 从最近的三个 finder 定位 QR 区域
  const top3 = finders.slice(0, 3);
  const qrRegion = getQRRegion(top3, gw, gh);
  if (!qrRegion) return null;

  // 计算模块大小和版本
  const moduleSize = estimateModuleSize(top3, qrRegion);
  if (!moduleSize || moduleSize < 2) return null;

  // 读取 QR 矩阵
  const matrix = readQRMatrix(gray, qrRegion, moduleSize);
  if (!matrix) return null;

  // 解码 QR 数据
  return decodeQRData(matrix);
}

function toGrayMatrix(pixels, w, h, sampleRate) {
  const gw = Math.floor(w / sampleRate);
  const gh = Math.floor(h / sampleRate);
  const gray = [];
  for (let y = 0; y < gh; y++) {
    gray[y] = [];
    for (let x = 0; x < gw; x++) {
      const px = Math.floor(x * sampleRate);
      const py = Math.floor(y * sampleRate);
      const idx = (py * w + px) * 4;
      const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
      gray[y][x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  return gray;
}

/**
 * 检测 Finder Patterns
 * Finder Pattern 特征：暗-亮-暗-亮-暗 比例为 1:1:3:1:1
 */
function findFinderPatterns(gray, w, h) {
  const finders = [];
  const threshold = getOtsuThreshold(gray, w, h);

  for (let y = 0; y < h; y++) {
    let state = -1;
    let segmentStart = 0;
    const runs = [];

    for (let x = 0; x < w; x++) {
      const bit = gray[y][x] < threshold ? 1 : 0;
      if (bit !== state) {
        if (state !== -1) runs.push(x - segmentStart);
        state = bit;
        segmentStart = x;
      }
    }
    runs.push(w - segmentStart);

    // 检查 1:1:3:1:1 模式
    for (let i = 4; i < runs.length; i++) {
      const ratios = [runs[i - 4], runs[i - 3], runs[i - 2], runs[i - 1], runs[i]];
      if (isFinderRatio(ratios)) {
        let x = 0;
        for (let j = 0; j <= i - 5; j++) x += runs[j];
        x += Math.floor(runs[i - 4] / 2);
        const centerX = x + runs[i - 4] + runs[i - 3] + Math.floor(runs[i - 2] / 2);
        finders.push({ x: centerX, y, confidence: 1 });
      }
    }
  }

  // 聚类去重（取均值）
  return clusterPoints(finders, 10);
}

function isFinderRatio(ratios) {
  const total = ratios.reduce((a, b) => a + b, 0);
  if (total < 7) return false;
  const normalized = ratios.map(r => r * 7 / total);
  const expected = [1, 1, 3, 1, 1];
  let diff = 0;
  for (let i = 0; i < 5; i++) {
    diff += Math.abs(normalized[i] - expected[i]);
  }
  return diff < 2.5;
}

function getOtsuThreshold(gray, w, h) {
  const hist = new Array(256).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      hist[gray[y][x]]++;
    }
  }
  let total = w * h;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVariance = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }
  return threshold;
}

function clusterPoints(points, dist) {
  if (points.length === 0) return [];
  const clusters = [];
  for (const pt of points) {
    let found = false;
    for (const cluster of clusters) {
      const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
      const cy = cluster.reduce((s, p) => s + p.y, 0) / cluster.length;
      if (Math.abs(pt.x - cx) < dist && Math.abs(pt.y - cy) < dist) {
        cluster.push(pt);
        found = true;
        break;
      }
    }
    if (!found) clusters.push([pt]);
  }

  return clusters
    .filter(c => c.length >= 2)
    .map(c => ({
      x: Math.round(c.reduce((s, p) => s + p.x, 0) / c.length),
      y: Math.round(c.reduce((s, p) => s + p.y, 0) / c.length),
    }))
    .slice(0, 3);
}

function getQRRegion(finders, gw, gh) {
  // 确定 QR 矩形区域
  const minX = Math.max(0, Math.min(...finders.map(f => f.x)) - 10);
  const minY = Math.max(0, Math.min(...finders.map(f => f.y)) - 10);
  const maxX = Math.min(gw, Math.max(...finders.map(f => f.x)) + 10);
  const maxY = Math.min(gh, Math.max(...finders.map(f => f.y)) + 10);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function estimateModuleSize(finders, region) {
  const avgDist = [];
  for (let i = 0; i < finders.length; i++) {
    for (let j = i + 1; j < finders.length; j++) {
      const dx = finders[i].x - finders[j].x;
      const dy = finders[i].y - finders[j].y;
      avgDist.push(Math.sqrt(dx * dx + dy * dy));
    }
  }
  if (avgDist.length === 0) return 0;
  const avg = avgDist.reduce((a, b) => a + b, 0) / avgDist.length;
  // QR 版本和模块数的估算
  return Math.max(2, Math.round(avg / 21)); // 至少 version 1 (21模块)
}

function readQRMatrix(gray, region, moduleSize) {
  const modules = Math.round(Math.max(region.w, region.h) / moduleSize);
  if (modules < 21 || modules > 177) return null;

  const matrix = [];
  const threshold = getOtsuThreshold(gray, region.w, region.h);

  for (let row = 0; row < modules; row++) {
    matrix[row] = [];
    for (let col = 0; col < modules; col++) {
      const cx = region.x + Math.round(col * moduleSize + moduleSize / 2);
      const cy = region.y + Math.round(row * moduleSize + moduleSize / 2);
      if (cy < gray.length && cx < gray[0].length) {
        matrix[row][col] = gray[cy][cx] < threshold ? 1 : 0;
      } else {
        matrix[row][col] = 0;
      }
    }
  }
  return matrix;
}

/**
 * 从二进制矩阵中提取 QR 数据
 * 简化版：按标准 QR 排列顺序读取数据位
 */
function decodeQRData(matrix) {
  const size = matrix.length;
  const bits = [];
  let dir = -1; // 扫描方向
  let col = size - 1;

  while (col > 0) {
    if (col === 6) col--; // 跳过垂直 timing pattern
    for (let row = 0; row < size; row++) {
      const r = dir < 0 ? size - 1 - row : row;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (cc < 0) continue;
        if (!isFunctionModule(r, cc, size)) {
          const bit = matrix[r][cc];
          if (typeof bit === 'number') bits.push(bit);
        }
      }
    }
    dir = -dir;
    col -= 2;
  }

  if (bits.length < 8) return null;

  // 转换为字节
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i + b];
    }
    bytes.push(byte);
  }

  // 解析 QR 数据段
  return parseQRDataBytes(bytes);
}

function isFunctionModule(row, col, size) {
  // 上方横向：左上 Finder
  if (row <= 8 && col <= 8) return true;
  // 上方横向：右上 Finder
  if (row <= 8 && col >= size - 8) return true;
  // 下方横向：左下 Finder
  if (row >= size - 8 && col <= 8) return true;
  // 水平 timing pattern
  if (row === 6) return true;
  // 垂直 timing pattern
  if (col === 6) return true;
  return false;
}

function parseQRDataBytes(bytes) {
  if (bytes.length < 2) return null;

  // 读取编码模式（前4位）
  const mode = (bytes[0] >> 4) & 0x0F;
  let charCountLen = 8; // 默认 8 位字符计数
  let encoding = 'utf-8';
  let bitPos = 4; // 当前位偏移
  let byteIdx = 0;

  // 读取字符计数
  if (mode === 2 || mode === 4) charCountLen = 8; // 字母数字/字节模式
  else if (mode === 1) charCountLen = 10; // 数字模式
  else if (mode === 3) charCountLen = 8; // 结构化追加

  let charCount = 0;
  for (let i = 0; i < charCountLen; i++) {
    charCount = (charCount << 1) | getBit(bytes, bitPos + i);
  }
  bitPos += charCountLen;

  if (charCount <= 0 || charCount > bytes.length * 8) return null;

  // 字节模式（mode=4）解码
  if (mode === 4) {
    const result = [];
    let byteStart = Math.floor(bitPos / 8);
    let bitOff = bitPos % 8;

    for (let i = 0; i < charCount && byteStart < bytes.length; i++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        byte = (byte << 1) | getBit(bytes, bitOff);
        bitOff++;
        if (bitOff >= 8) {
          bitOff = 0;
          byteStart++;
        }
      }
      if (byte >= 0x20 && byte < 0x7F) {
        result.push(String.fromCharCode(byte));
      }
    }
    if (result.length > 0) {
      return { result: result.join(''), scanType: 'QR_CODE' };
    }
  }

  // 尝试简单提取可见文本
  let text = '';
  for (let i = 1; i < bytes.length && text.length < 100; i++) {
    if (bytes[i] >= 0x20 && bytes[i] < 0x7F) {
      text += String.fromCharCode(bytes[i]);
    }
  }
  if (text.length >= 3) {
    return { result: text, scanType: 'QR_CODE' };
  }

  return null;
}

function getBit(bytes, pos) {
  const byteIdx = Math.floor(pos / 8);
  const bitIdx = pos % 8;
  if (byteIdx >= bytes.length) return 0;
  return (bytes[byteIdx] >> (7 - bitIdx)) & 1;
}

// ============ 一维条码解码 ============

/**
 * 一维条码解码
 * 扫描多行 → 检测黑白过渡 → 测量宽度 → 匹配格式
 */
function decodeBarcode(pixels, w, h, sampleRate) {
  const gray = toGrayMatrix(pixels, w, h, sampleRate);
  const gw = gray[0].length;
  const gh = gray.length;

  const threshold = getOtsuThreshold(gray, gw, gh);

  // 扫描中间区域的水平线来检测条码
  const scanRows = 20;
  const startRow = Math.floor(gh * 0.3);
  const endRow = Math.floor(gh * 0.7);

  let bestResult = null;
  let bestConfidence = 0;

  for (let i = 0; i < scanRows; i++) {
    const y = Math.floor(startRow + (endRow - startRow) * i / (scanRows - 1));
    const transitions = getTransitions(gray, y, gw, threshold);
    if (transitions.length < 10) continue;

    // 过滤掉过渡区域太少的行
    const widths = [];
    for (let j = 1; j < transitions.length; j++) {
      widths.push(transitions[j] - transitions[j - 1]);
    }

    // 条码最少需要 20 个以上的条/空
    if (widths.length < 15) continue;

    // 尝试解码
    const result = tryDecodeBarcode(widths, gray, y, gw, threshold);
    if (result && result.confidence > bestConfidence) {
      bestResult = result;
      bestConfidence = result.confidence;
    }
  }

  if (bestResult && bestResult.confidence > 0.5) {
    return { result: bestResult.code, scanType: 'BAR_CODE' };
  }
  return null;
}

function getTransitions(gray, y, w, threshold) {
  const transitions = [0];
  let lastBit = gray[y][0] < threshold ? 1 : 0;
  for (let x = 1; x < w; x++) {
    const bit = gray[y][x] < threshold ? 1 : 0;
    if (bit !== lastBit) {
      transitions.push(x);
      lastBit = bit;
    }
  }
  transitions.push(w);
  return transitions;
}

/**
 * 尝试解码一维条码
 */
function tryDecodeBarcode(widths, gray, y, gw, threshold) {
  // 使用条码宽度比计算模块宽度
  const sorted = [...widths].sort((a, b) => a - b);
  const moduleWidth = sorted[Math.floor(sorted.length * 0.2)]; // 取 20% 分位数

  if (moduleWidth < 1) return null;

  // 归一化宽度为模块数
  const modules = [];
  for (const w of widths) {
    modules.push(Math.max(1, Math.round(w / moduleWidth)));
  }

  // 尝试 EAN-13 (95 模块 = 6+1+6+1+6+1+6+1+6+1+6+1+6+1+6 = 95)
  // 3 start(101) + 6*7 left + 5 middle(01010) + 6*7 right + 3 end(101) = 95
  if (modules.length >= 25) {
    const ean13 = decodeEAN13(modules, widths, moduleWidth);
    if (ean13) return ean13;
  }

  // 尝试 EAN-8 (67 模块)
  if (modules.length >= 20) {
    const ean8 = decodeEAN8(modules, widths, moduleWidth);
    if (ean8) return ean8;
  }

  // 尝试 UPC-A
  if (modules.length >= 25) {
    const upca = decodeUPCA(modules, widths, moduleWidth);
    if (upca) return upca;
  }

  // 尝试 Code 128
  if (modules.length >= 10) {
    const code128 = decodeCode39(modules, widths, moduleWidth);
    if (code128) return code128;
  }

  return null;
}

/**
 * EAN-13 解码
 */
function decodeEAN13(modules, widths, moduleWidth) {
  const total = modules.reduce((a, b) => a + b, 0);
  const expectedTotal = 95;

  // 容差检查
  if (Math.abs(total - expectedTotal) > 15) return null;

  // 寻找 start guard (101)
  let pos = findGuardPattern(modules, [1, 0, 1], 0);
  if (pos < 0) return null;
  pos += 3;

  // 读取 6 个左侧数字
  let rawDigits = '';
  const leftPatterns = [];
  for (let d = 0; d < 6 && pos + 7 <= modules.length; d++) {
    const segment = modules.slice(pos, pos + 7);
    const sum = segment.reduce((a, b) => a + b, 0);
    if (sum < 5 || sum > 9) return null;
    const pattern = segment.map(v => v >= 2 ? '1' : '0').join('');
    leftPatterns.push(pattern);
    pos += 7;
  }

  // 校验中间分隔符 (01010)
  if (pos + 5 > modules.length) return null;
  const middle = modules.slice(pos, pos + 5);
  const midSum = middle.reduce((a, b) => a + b, 0);
  if (midSum < 3 || midSum > 7) return null; // 宽松匹配
  pos += 5;

  // 读取 6 个右侧数字
  const rightDigits = [];
  for (let d = 0; d < 6 && pos + 7 <= modules.length; d++) {
    const segment = modules.slice(pos, pos + 7);
    const sum = segment.reduce((a, b) => a + b, 0);
    if (sum < 5 || sum > 9) return null;
    const pattern = segment.map(v => v >= 2 ? '1' : '0').join('');
    const digit = decodeRightEAN(pattern);
    if (digit >= 0) rightDigits.push(digit);
    pos += 7;
  }

  if (rightDigits.length !== 6) return null;

  // 解码左侧数字
  const firstDigit = decodeFirstDigitEAN13(leftPatterns);
  const leftDigits = [];
  for (let i = 0; i < 6; i++) {
    const d = decodeLeftEAN(leftPatterns[i]);
    if (d >= 0) leftDigits.push(d);
  }

  if (firstDigit === null || firstDigit >= 10) firstDigit = 0;
  if (leftDigits.length < 6) return null;

  const code = firstDigit + leftDigits.join('') + rightDigits.join('');
  if (code.length === 13 && /^\d{13}$/.test(code)) {
    return { code, confidence: 0.8, scanType: 'EAN_13' };
  }

  return null;
}

function decodeEAN8(modules, widths, moduleWidth) {
  return null; // 简化版暂不实现
}

function decodeUPCA(modules, widths, moduleWidth) {
  // UPC-A 就是首数字为 0 的 EAN-13
  const ean13 = decodeEAN13(modules, widths, moduleWidth);
  if (ean13 && ean13.code.startsWith('0')) {
    return { code: ean13.code.substring(1), confidence: 0.75, scanType: 'UPC_A' };
  }
  return null;
}

function decodeCode39(modules, widths, moduleWidth) {
  return null; // 简化版暂不实现
}

// EAN 模式表
const L_CODES = {
  '0001101': 0, '0011001': 1, '0010011': 2, '0111101': 3, '0100011': 4,
  '0110001': 5, '0101111': 6, '0111011': 7, '0110111': 8, '0001011': 9
};
const G_CODES = {
  '0100111': 0, '0110011': 1, '0011011': 2, '0100001': 3, '0011101': 4,
  '0111001': 5, '0000101': 6, '0010001': 7, '0001001': 8, '0010111': 9
};
const R_CODES = {
  '1110010': 0, '1100110': 1, '1101100': 2, '1000010': 3, '1011100': 4,
  '1001110': 5, '1010000': 6, '1000100': 7, '1001000': 8, '1110100': 9
};
const FIRST_DIGIT_PATTERNS = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
];

function decodeLeftEAN(pattern) {
  const l = L_CODES[pattern];
  if (l !== undefined) return l;
  const g = G_CODES[pattern];
  if (g !== undefined) return g;
  return -1;
}

function decodeRightEAN(pattern) {
  const r = R_CODES[pattern];
  return r !== undefined ? r : -1;
}

function decodeFirstDigitEAN13(patterns) {
  if (patterns.length < 6) return null;
  let lg = '';
  for (let i = 0; i < 6; i++) {
    lg += G_CODES[patterns[i]] !== undefined ? 'G' : 'L';
  }
  return FIRST_DIGIT_PATTERNS.indexOf(lg);
}

function findGuardPattern(modules, pattern, start) {
  for (let i = start; i + pattern.length <= modules.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      const expected = pattern[j];
      const actual = modules[i + j] >= 2 ? 1 : 0;
      if (actual !== expected) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

// ============ 回退到 wx.scanCode ============

function fallbackToScanCode(imagePath, onSuccess, onFail) {
  wx.scanCode({
    onlyFromCamera: false,
    imageFile: imagePath,
    success: (res) => {
      onSuccess && onSuccess(res.result, res.scanType);
    },
    fail: () => {
      onFail && onFail('未识别到条码/二维码');
    }
  });
}

module.exports = {
  decodeFromImage
};
