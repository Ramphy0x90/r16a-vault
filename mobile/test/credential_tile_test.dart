import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:r16a_vault/core/crypto/vault_crypto.dart';
import 'package:r16a_vault/core/theme/theme.dart';
import 'package:r16a_vault/features/credentials/credential_tile.dart';
import 'package:r16a_vault/features/credentials/credentials_controller.dart';

Widget _host(Widget child, {Brightness b = Brightness.light}) => MaterialApp(
  theme: buildTheme(b),
  home: Scaffold(body: child),
);

void main() {
  const meta = CredentialMeta(name: 'mail', url: 'https://mail.example.com/', username: 'alice', hasTotp: true);

  testWidgets('shows name, username, host, initial and 2FA badge', (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      _host(
        CredentialTile(
          entry: const CredentialEntry(id: '1', meta: meta, secretBlob: 'x'),
          onTap: () => taps++,
        ),
      ),
    );
    expect(find.text('mail'), findsOneWidget);
    expect(find.text('alice · mail.example.com'), findsOneWidget);
    expect(find.text('M'), findsOneWidget);
    expect(find.text('2FA'), findsOneWidget);
    await tester.tap(find.byType(ListTile));
    expect(taps, 1);
  });

  testWidgets('never renders secret material', (tester) async {
    await tester.pumpWidget(
      _host(
        const CredentialTile(
          entry: CredentialEntry(id: '1', meta: meta, secretBlob: 'c2VjcmV0LWJsb2I='),
          onTap: _noop,
        ),
      ),
    );
    expect(find.textContaining('c2VjcmV0'), findsNothing);
  });

  testWidgets('flags rows that failed to decrypt', (tester) async {
    await tester.pumpWidget(
      _host(
        const CredentialTile(
          entry: CredentialEntry(id: '1', meta: null, secretBlob: 'x'),
          onTap: _noop,
        ),
      ),
    );
    expect(find.text('Unreadable entry'), findsOneWidget);
  });

  testWidgets('meets the 48 dp tap target and renders in dark mode', (tester) async {
    await tester.pumpWidget(
      _host(
        const CredentialTile(
          entry: CredentialEntry(id: '1', meta: meta, secretBlob: 'x'),
          onTap: _noop,
        ),
        b: Brightness.dark,
      ),
    );
    expect(tester.getSize(find.byType(ListTile)).height, greaterThanOrEqualTo(48));
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
  });
}

void _noop() {}
