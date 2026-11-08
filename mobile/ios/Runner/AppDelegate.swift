import Flutter
import UIKit
import UniformTypeIdentifiers

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  /// Pasteboard change count right after our last sensitive copy, so a later clear can tell
  /// whether the user copied something else meanwhile without reading the pasteboard, which
  /// would trigger the system paste prompt.
  private var ownedChangeCount: Int?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "R16aClipboard") else { return }
    let channel = FlutterMethodChannel(name: "dev.r16a.vault/clipboard", binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "copySensitive":
        guard let args = call.arguments as? [String: Any], let text = args["text"] as? String else {
          result(false)
          return
        }
        // Local only keeps the secret off Universal Clipboard, and the expiry removes it even
        // if the app is suspended before its own timer can run.
        UIPasteboard.general.setItems(
          [[UTType.plainText.identifier: text]],
          options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(30)]
        )
        self?.ownedChangeCount = UIPasteboard.general.changeCount
        result(true)
      case "clearIfOurs":
        if let owned = self?.ownedChangeCount, owned == UIPasteboard.general.changeCount {
          UIPasteboard.general.setItems([], options: [:])
        }
        self?.ownedChangeCount = nil
        result(true)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}
