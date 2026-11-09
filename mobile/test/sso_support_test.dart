import 'package:flutter_test/flutter_test.dart';
import 'package:r16a_vault/core/session/session_service.dart';

void main() {
  test('https sign in callbacks need iOS 17.4 or later', () {
    expect(SessionService.iosSupportsHttpsCallback('Version 17.4 (Build 21E213)'), isTrue);
    expect(SessionService.iosSupportsHttpsCallback('Version 18.0 (Build 22A3354)'), isTrue);
    expect(SessionService.iosSupportsHttpsCallback('Version 17.3.1 (Build 21D61)'), isFalse);
    expect(SessionService.iosSupportsHttpsCallback('Version 16.7 (Build 20H19)'), isFalse);
    expect(SessionService.iosSupportsHttpsCallback('unknown'), isFalse);
  });
}
