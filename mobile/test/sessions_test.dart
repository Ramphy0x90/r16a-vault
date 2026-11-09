import 'package:flutter_test/flutter_test.dart';
import 'package:r16a_vault/features/settings/sessions_section.dart';

void main() {
  test('names devices from their user agents', () {
    expect(describeDevice('r16a vault mobile (Android)'), 'Zaltys app on Android');
    expect(
      describeDevice(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
      'Chrome on Linux',
    );
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/604.1'), 'Safari on iOS');
    expect(describeDevice(null), 'Unknown device');
    expect(describeDevice('curl/8.0'), 'Unknown device');
  });
}
