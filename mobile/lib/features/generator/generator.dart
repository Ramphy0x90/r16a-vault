/// Password and passphrase generation, mirroring web/src/app/generator/generator.ts.
/// The random source is injectable for tests, production uses the platform CSPRNG.
library;

import 'dart:math';

typedef RandomUint32 = int Function();

final _secure = Random.secure();

/// Two 16 bit draws make one uniform 32 bit value, since nextInt is capped at 2^32.
int cryptoRandom() => (_secure.nextInt(1 << 16) << 16) | _secure.nextInt(1 << 16);

const _two32 = 0x100000000;

/// Uniform integer in [0, n). Values from the partial top bucket are redrawn, so no
/// result is more likely than another.
int uniformInt(int n, [RandomUint32 rand = cryptoRandom]) {
  if (n <= 0 || n > _two32) throw RangeError.range(n, 1, _two32, 'n');
  final limit = _two32 - (_two32 % n);
  while (true) {
    final x = rand();
    if (x < limit) return x % n;
  }
}

List<T> shuffle<T>(List<T> items, [RandomUint32 rand = cryptoRandom]) {
  for (var i = items.length - 1; i > 0; i--) {
    final j = uniformInt(i + 1, rand);
    final t = items[i];
    items[i] = items[j];
    items[j] = t;
  }
  return items;
}

enum CharClass { upper, lower, digits, symbols }

const charsets = {
  CharClass.upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  CharClass.lower: 'abcdefghijklmnopqrstuvwxyz',
  CharClass.digits: '0123456789',
  CharClass.symbols: r'!@#$%^&*()-_=+[]{};:,.?/~',
};
const ambiguous = 'Il1O0o|';
const minLength = 8;
const maxLength = 128;
const minWords = 3;
const maxWords = 20;

class RandomOptions {
  const RandomOptions({this.length = 20, this.classes = const {...CharClass.values}, this.excludeAmbiguous = true});

  final int length;
  final Set<CharClass> classes;
  final bool excludeAmbiguous;

  RandomOptions copyWith({int? length, Set<CharClass>? classes, bool? excludeAmbiguous}) => RandomOptions(
    length: length ?? this.length,
    classes: classes ?? this.classes,
    excludeAmbiguous: excludeAmbiguous ?? this.excludeAmbiguous,
  );
}

class PassphraseOptions {
  const PassphraseOptions({this.words = 6, this.separator = '-', this.capitalise = true, this.includeNumber = false});

  final int words;
  final String separator;
  final bool capitalise;
  final bool includeNumber;

  PassphraseOptions copyWith({int? words, String? separator, bool? capitalise, bool? includeNumber}) =>
      PassphraseOptions(
        words: words ?? this.words,
        separator: separator ?? this.separator,
        capitalise: capitalise ?? this.capitalise,
        includeNumber: includeNumber ?? this.includeNumber,
      );
}

List<String> classAlphabets(RandomOptions o) => [
  for (final c in CharClass.values)
    if (o.classes.contains(c))
      o.excludeAmbiguous ? charsets[c]!.split('').where((ch) => !ambiguous.contains(ch)).join() : charsets[c]!,
];

int _clampLength(int l) => l.clamp(minLength, maxLength);

/// One character from every selected class, the rest from the union, then shuffled.
String generatePassword(RandomOptions o, [RandomUint32 rand = cryptoRandom]) {
  final alphabets = classAlphabets(o);
  if (alphabets.isEmpty) throw ArgumentError('select at least one character class');
  final pool = alphabets.join();
  final length = _clampLength(o.length);
  final chars = [for (final a in alphabets) a[uniformInt(a.length, rand)]];
  while (chars.length < length) {
    chars.add(pool[uniformInt(pool.length, rand)]);
  }
  return shuffle(chars, rand).join();
}

/// Entropy of a uniform choice among strings that contain every selected class, computed by
/// inclusion and exclusion over ratios below one to stay numerically stable.
double passwordEntropy(RandomOptions o) {
  final sizes = classAlphabets(o).map((a) => a.length).toList();
  final total = sizes.fold<int>(0, (a, b) => a + b);
  if (total == 0) return 0;
  final length = _clampLength(o.length);
  var ratio = 0.0;
  for (var mask = 0; mask < 1 << sizes.length; mask++) {
    var excluded = 0;
    var bits = 0;
    for (var i = 0; i < sizes.length; i++) {
      if (mask & (1 << i) != 0) {
        excluded += sizes[i];
        bits++;
      }
    }
    ratio += (bits.isOdd ? -1 : 1) * pow((total - excluded) / total, length);
  }
  return length * log(total) / ln2 + log(max(ratio, double.minPositive)) / ln2;
}

String generatePassphrase(List<String> wordlist, PassphraseOptions o, [RandomUint32 rand = cryptoRandom]) {
  final count = o.words.clamp(minWords, maxWords);
  final words = List.generate(count, (_) {
    final w = wordlist[uniformInt(wordlist.length, rand)];
    return o.capitalise ? '${w[0].toUpperCase()}${w.substring(1)}' : w;
  });
  if (o.includeNumber) {
    final at = uniformInt(count, rand);
    words[at] = '${words[at]}${uniformInt(10, rand)}';
  }
  return words.join(o.separator);
}

double passphraseEntropy(int wordlistSize, PassphraseOptions o) {
  final count = o.words.clamp(minWords, maxWords);
  return count * log(wordlistSize) / ln2 + (o.includeNumber ? log(10 * count) / ln2 : 0);
}

enum Strength { weak, fair, strong, excellent }

Strength strengthOf(double bits) => bits < 50
    ? Strength.weak
    : bits < 70
    ? Strength.fair
    : bits < 100
    ? Strength.strong
    : Strength.excellent;
