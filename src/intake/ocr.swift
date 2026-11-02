import AppKit
import Foundation
import PDFKit
import Vision

func recognize(_ image: NSImage) throws -> String {
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw NSError(domain: "JobAgentOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法读取图片"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: cgImage).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

guard CommandLine.arguments.count == 2 else {
    fputs("用法: ocr.swift <图片或 PDF 路径>\n", stderr)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let ext = url.pathExtension.lowercased()
do {
    if ext == "pdf" {
        guard let document = PDFDocument(url: url) else { throw NSError(domain: "JobAgentOCR", code: 2) }
        var pages: [String] = []
        for index in 0..<min(document.pageCount, 20) {
            guard let page = document.page(at: index) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let scale = 1800.0 / max(bounds.width, 1)
            let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
            pages.append(try recognize(image))
        }
        print(pages.joined(separator: "\n"))
    } else {
        guard let image = NSImage(contentsOf: url) else { throw NSError(domain: "JobAgentOCR", code: 3) }
        print(try recognize(image))
    }
} catch {
    fputs("OCR 失败: \(error.localizedDescription)\n", stderr)
    exit(1)
}
