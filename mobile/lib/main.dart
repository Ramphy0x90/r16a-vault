import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/prefs/prefs.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Flutter lists package licences on its own. The wordlist is an asset, so its CC BY
  // attribution is registered by hand.
  LicenseRegistry.addLicense(
    () => Stream.value(const LicenseEntryWithLineBreaks(['EFF large wordlist'], effWordlistAttribution)),
  );
  final prefs = await SharedPreferences.getInstance();
  runApp(ProviderScope(overrides: [prefsProvider.overrideWithValue(prefs)], child: const R16aVaultApp()));
}

const effWordlistAttribution = """EFF Large Wordlist for Passphrases
Electronic Frontier Foundation, https://www.eff.org/dice
Licensed under Creative Commons Attribution 3.0 United States (CC BY 3.0 US),
https://creativecommons.org/licenses/by/3.0/us/

Modification: the dice numbers that prefix each word in the original file were removed,
leaving one word per line. The words themselves are unchanged.""";
