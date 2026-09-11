/* Thin wrapper around the browser's speech synthesis so RouteSteps doesn't
   have to deal with the API directly. No network calls, no key — this is
   built into the browser. */

export function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function speak(text, { onend, onerror } = {}) {
  if (!ttsSupported() || !text) return null
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'en-US'
  utter.rate = 1
  if (onend) utter.onend = onend
  if (onerror) utter.onerror = onerror
  window.speechSynthesis.speak(utter)
  return utter
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel()
}
