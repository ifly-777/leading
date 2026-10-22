import AVFoundation

/// Read Aloud: speaks the passages the page hands it, one utterance each, and
/// reports each word as it is spoken so the page can mark it and keep it in view.
/// The voice is the one chosen in System Settings › Accessibility › Spoken Content.
final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    private let synth = AVSpeechSynthesizer()
    private var utterances: [AVSpeechUtterance] = []
    /// Passage index and the word's range within it (UTF-16, as the page counts).
    var onWord: ((Int, Int, Int) -> Void)?
    /// Reading stopped: finished, or stopped by the reader.
    var onEnd: (() -> Void)?
    private(set) var isSpeaking = false

    override init() {
        super.init()
        synth.delegate = self
    }

    func speak(_ passages: [String], language: String?) {
        stop()
        utterances = passages.map { text in
            let u = AVSpeechUtterance(string: text)
            // The reader's own Spoken Content voice and rate; a note in another
            // language falls back to a voice for that language.
            u.prefersAssistiveTechnologySettings = true
            if let language, !language.lowercased().hasPrefix("en"), let v = AVSpeechSynthesisVoice(language: language) { u.voice = v }
            u.postUtteranceDelay = 0.12 // a breath between paragraphs
            return u
        }
        guard !utterances.isEmpty else { onEnd?(); return }
        isSpeaking = true
        for u in utterances { synth.speak(u) }
    }

    func stop() {
        guard isSpeaking else { return }
        isSpeaking = false
        utterances = []
        synth.stopSpeaking(at: .immediate)
        onEnd?()
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeakRangeOfSpeechString range: NSRange, utterance: AVSpeechUtterance) {
        guard let i = utterances.firstIndex(where: { $0 === utterance }) else { return }
        onWord?(i, range.location, range.length)
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard isSpeaking, utterance === utterances.last else { return }
        isSpeaking = false
        utterances = []
        onEnd?()
    }
}
