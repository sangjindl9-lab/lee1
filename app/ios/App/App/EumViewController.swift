import UIKit
import Capacitor

/// 앱 안에 둔 플러그인(EumFiles)을 등록하는 화면. Main.storyboard 의 시작 화면이 이 클래스다.
class EumViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(EumFilesPlugin())
    }
}
