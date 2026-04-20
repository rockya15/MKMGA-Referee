import { useEffect, useRef, useState, useCallback } from 'react';

// Duration of the spin animation in ms
const SPIN_DURATION = 3500;
// Full rotations to add for realism
const FULL_ROTATIONS = 5;

function getSegmentColors(count) {
  const palette = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
    '#9b59b6', '#1abc9c', '#e67e22', '#e91e63',
    '#00bcd4', '#8bc34a', '#ff5722', '#607d8b',
    '#795548'
  ];
  return Array.from({ length: count }, (_, i) => palette[i % palette.length]);
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 4);
}

/**
 * SpinningWheel
 *
 * Props:
 *   segments        — array of { id, label } for each remaining player on the wheel
 *   targetIndex     — index in `segments` to land on (the pre-determined winner)
 *   spinning        — boolean; set true to trigger a spin animation
 *   onSpinComplete  — callback fired when animation ends
 *   size            — canvas size in px (default 500)
 */
export default function SpinningWheel({ segments, targetIndex, spinning, onSpinComplete, size = 500 }) {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const startTimeRef = useRef(null);
  const startAngleRef = useRef(0);
  const targetAngleRef = useRef(0);

  const center = size / 2;
  const radius = center - 10;

  const colors = getSegmentColors(segments.length);

  const drawWheel = useCallback((currentAngle) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const n = segments.length;
    if (n === 0) return;

    ctx.clearRect(0, 0, size, size);

    const sliceAngle = (2 * Math.PI) / n;

    segments.forEach((seg, i) => {
      const start = currentAngle + i * sliceAngle;
      const end = start + sliceAngle;

      // Slice
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = colors[i];
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      const labelAngle = start + sliceAngle / 2;
      const labelRadius = radius * 0.65;
      const x = center + labelRadius * Math.cos(labelAngle);
      const y = center + labelRadius * Math.sin(labelAngle);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(labelAngle + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(10, Math.min(18, Math.floor(radius / n * 1.2)))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Truncate long names
      const maxChars = n <= 4 ? 14 : n <= 8 ? 10 : 7;
      const label = seg.label.length > maxChars ? seg.label.slice(0, maxChars - 1) + '…' : seg.label;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });

    // Center circle
    ctx.beginPath();
    ctx.arc(center, center, 18, 0, 2 * Math.PI);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pointer (top)
    ctx.beginPath();
    ctx.moveTo(center, 8);
    ctx.lineTo(center - 12, 30);
    ctx.lineTo(center + 12, 30);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [segments, colors, center, radius, size]);

  // Compute target angle so that targetIndex segment sits under the pointer (top = -PI/2)
  const computeTargetAngle = useCallback(() => {
    const n = segments.length;
    if (n === 0) return 0;
    const sliceAngle = (2 * Math.PI) / n;
    // The pointer is at -PI/2 (top). We want the center of targetIndex's slice to land there.
    // Slice i starts at: baseAngle + i * sliceAngle, center at: baseAngle + i*sliceAngle + sliceAngle/2
    // We want: baseAngle + targetIndex*sliceAngle + sliceAngle/2 = -PI/2 (mod 2PI)
    // => baseAngle = -PI/2 - targetIndex*sliceAngle - sliceAngle/2
    const target = -Math.PI / 2 - targetIndex * sliceAngle - sliceAngle / 2;
    // Add full rotations
    return target - FULL_ROTATIONS * 2 * Math.PI;
  }, [segments.length, targetIndex]);

  // Animate
  useEffect(() => {
    if (!spinning) return;

    const finalAngle = computeTargetAngle();
    startAngleRef.current = startAngleRef.current % (2 * Math.PI); // keep current angle
    // Ensure we always spin forward (add enough rotations)
    let delta = finalAngle - startAngleRef.current;
    // delta should be very negative (spinning forward = CCW in canvas, but visually CW on screen)
    // We actually spin by adding negative angle (canvas CW = negative direction... let's just use absolute target)
    targetAngleRef.current = finalAngle;
    startTimeRef.current = null;

    const animate = (timestamp) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const t = Math.min(elapsed / SPIN_DURATION, 1);
      const eased = easeOut(t);

      const current = startAngleRef.current + (targetAngleRef.current - startAngleRef.current) * eased;
      drawWheel(current);

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        startAngleRef.current = targetAngleRef.current;
        drawWheel(targetAngleRef.current);
        if (onSpinComplete) onSpinComplete();
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [spinning, computeTargetAngle, drawWheel, onSpinComplete]);

  // Draw idle state
  useEffect(() => {
    if (!spinning) {
      drawWheel(startAngleRef.current);
    }
  }, [spinning, drawWheel, segments]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ display: 'block', margin: '0 auto' }}
    />
  );
}
