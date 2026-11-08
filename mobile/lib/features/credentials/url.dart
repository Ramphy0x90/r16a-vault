/// Accepts what people type, such as `example.com`, and returns an absolute http or https
/// URL. Returns null for empty input and throws FormatException for unusable input.
String? normaliseUrl(String input) {
  final raw = input.trim();
  if (raw.isEmpty) return null;
  final withScheme = RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*:').hasMatch(raw) ? raw : 'https://$raw';
  final uri = Uri.tryParse(withScheme);
  if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http') || uri.host.isEmpty) {
    throw const FormatException('invalid url');
  }
  return uri.toString();
}

String hostOf(String? url) => url == null ? '' : (Uri.tryParse(url)?.host ?? '');
