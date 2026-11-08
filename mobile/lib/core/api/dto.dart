import '../crypto/protocol.dart';

/// Typed views of API responses. Parsing fails with a FormatException that the error mapper
/// turns into a friendly message, instead of a cast error deep inside a flow.
T _field<T>(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is T) return value;
  throw FormatException('unexpected response field $key');
}

KdfParams _kdf(Map<String, dynamic> json) => KdfParams.fromJson(_field<Map<String, dynamic>>(json, 'kdf'));

class Prelogin {
  Prelogin.fromJson(Map<String, dynamic> json) : kdf = _kdf(json), salt = _field<String>(json, 'salt');

  final KdfParams kdf;
  final String salt;
}

/// Response of register and login.
class SignedIn {
  SignedIn.fromJson(Map<String, dynamic> json)
    : username = _field<String>(_field<Map<String, dynamic>>(json, 'user'), 'username'),
      kdf = _kdf(json),
      salt = _field<String>(json, 'salt'),
      wrappedVaultKey = _field<String>(json, 'wrappedVaultKey'),
      token = _field<String>(json, 'token');

  final String username;
  final KdfParams kdf;
  final String salt;
  final String wrappedVaultKey;
  final String token;
}

class Unlocked {
  Unlocked.fromJson(Map<String, dynamic> json)
    : kdf = _kdf(json),
      salt = _field<String>(json, 'salt'),
      wrappedVaultKey = _field<String>(json, 'wrappedVaultKey'),
      token = json['token'] is String ? json['token'] as String : null;

  final KdfParams kdf;
  final String salt;
  final String wrappedVaultKey;
  final String? token;
}

class Me {
  Me.fromJson(Map<String, dynamic> json)
    : username = _field<String>(json, 'username'),
      kdf = _kdf(json),
      salt = _field<String>(json, 'salt');

  final String username;
  final KdfParams kdf;
  final String salt;
}

class CredentialRow {
  CredentialRow.fromJson(Map<String, dynamic> json)
    : id = _field<String>(json, 'id'),
      meta = _field<String>(json, 'meta'),
      secret = _field<String>(json, 'secret');

  final String id;
  final String meta;
  final String secret;
}

class OidcExchange {
  OidcExchange.fromJson(Map<String, dynamic> json)
    : token = _field<String>(json, 'token'),
      pending = json['state'] == 'pending',
      suggestedUsername = json['suggestedUsername'] is String ? json['suggestedUsername'] as String : null;

  final String token;
  final bool pending;
  final String? suggestedUsername;
}

class SessionInfo {
  SessionInfo.fromJson(Map<String, dynamic> json)
    : id = _field<String>(json, 'id'),
      current = json['current'] == true,
      locked = json['state'] == 'pre_auth',
      userAgent = json['userAgent'] is String ? json['userAgent'] as String : null,
      lastSeenAt = DateTime.parse(_field<String>(json, 'lastSeenAt'));

  final String id;
  final bool current;
  final bool locked;
  final String? userAgent;
  final DateTime lastSeenAt;
}
