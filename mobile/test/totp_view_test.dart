import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:r16a_vault/features/credentials/credential_details_sheet.dart';

Widget _host(TotpView view) => MaterialApp(home: Scaffold(body: view));

void main() {
  testWidgets('hidden code shows dots with reveal and copy, like the password row', (tester) async {
    var toggled = 0;
    var copied = 0;
    await tester.pumpWidget(
      _host(
        TotpView(code: null, remaining: 0, period: 30, busy: false, onToggle: () => toggled++, onCopy: () => copied++),
      ),
    );
    expect(find.text('••• •••'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await tester.tap(find.byTooltip('Reveal one time code'));
    await tester.tap(find.byTooltip('Copy one time code'));
    expect((toggled, copied), (1, 1));
  });

  testWidgets('shown code is grouped with a countdown and a hide toggle', (tester) async {
    await tester.pumpWidget(
      _host(TotpView(code: '123456', remaining: 12, period: 30, busy: false, onToggle: () {}, onCopy: () {})),
    );
    expect(find.text('123 456'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.byTooltip('Hide one time code'), findsOneWidget);
  });

  testWidgets('busy disables both actions', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      _host(TotpView(code: null, remaining: 0, period: 30, busy: true, onToggle: () => calls++, onCopy: () => calls++)),
    );
    await tester.tap(find.byTooltip('Reveal one time code'));
    await tester.tap(find.byTooltip('Copy one time code'));
    expect(calls, 0);
  });
}
