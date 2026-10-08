// Share into LifeLog on iOS (0.250.0): the app's entry in the Share sheet.
//
// A share extension is its own process and can't call into the app, so what
// arrives (a link, a text, a page title) is written into the App Group as
// share.json, and the app is asked to open through lifelog://action/share,
// a wake-up with nothing in it: the app's Widgets plugin hands share.json
// over as the "share?title=…&text=…&url=…" action src/share.js reads. Should
// iOS refuse the open (it isn't a documented ability of a share extension,
// only a reliable one), the file waits for the next time the app is opened.
//
// No UI of its own: the sheet closes as soon as the content is read.
import UIKit

class ShareViewController: UIViewController {
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        collect()
    }

    private func collect() {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        var title = "", text = "", url = ""
        let group = DispatchGroup()
        for item in items {
            if title.isEmpty, let t = item.attributedTitle?.string { title = t }
            if text.isEmpty, let t = item.attributedContentText?.string { text = t }
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier("public.url") {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: "public.url", options: nil) { value, _ in
                        if let u = value as? URL { url = u.absoluteString }
                        else if let d = value as? Data, let s = String(data: d, encoding: .utf8) { url = s }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier("public.plain-text") {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: "public.plain-text", options: nil) { value, _ in
                        if let s = value as? String { text = s }
                        else if let d = value as? Data, let s = String(data: d, encoding: .utf8) { text = s }
                        group.leave()
                    }
                }
            }
        }
        group.notify(queue: .main) { self.finish(title: title, text: text, url: url) }
    }

    private func finish(title: String, text: String, url: String) {
        if finished { return }
        finished = true
        LLShare.save(title: title, text: text, url: url)
        openApp()
        // The open is asked for, not awaited; a beat so it isn't cancelled by
        // the sheet closing underneath it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }

    // UIApplication isn't available to an extension, but the responder
    // chain ends in it, and openURL: still answers there.
    private func openApp() {
        guard let link = URL(string: "lifelog://action/share") else { return }
        let selector = sel_registerName("openURL:")
        var responder: UIResponder? = self
        while let r = responder {
            if r.responds(to: selector) {
                r.perform(selector, with: link)
                return
            }
            responder = r.next
        }
    }
}
