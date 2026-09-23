"use client";

/** Формат записи для серверного распознавания: первый, который умеет браузер (Chrome и Firefox — webm/opus, Safari — mp4). */
export function pickRecorderMime(): string {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

/** Шумоподавление и эхо браузера: без них запись в зале хуже распознаётся, а голос робота попадает в микрофон. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};
