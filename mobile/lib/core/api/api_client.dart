import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../crypto/protocol.dart';
import '../prefs/prefs.dart';
import '../session/token_store.dart';
import 'api_error.dart';
import 'dto.dart';

/// Fires when the server reports the session as gone, so the app can reset to sign in.
final sessionExpiredProvider = NotifierProvider<SessionExpired, int>(SessionExpired.new);

class SessionExpired extends Notifier<int> {
  @override
  int build() => 0;

  void fire() => state++;
}

final apiClientProvider = Provider<ApiClient>((ref) {
  final prefs = ref.watch(prefsProvider);
  return ApiClient(
    baseUrl: prefs.getString(PrefKeys.serverUrl) ?? '',
    tokens: ref.watch(tokenStoreProvider),
    onExpired: () => ref.read(sessionExpiredProvider.notifier).fire(),
  );
});

/// Validates a user supplied server address. HTTPS is mandatory, except loopback and the
/// Android emulator host in debug builds, which is how local development reaches compose.
String? normaliseServerUrl(String input) {
  final raw = input.trim().replaceAll(RegExp(r'/+$'), '');
  final uri = Uri.tryParse(raw.contains('://') ? raw : 'https://$raw');
  if (uri == null || uri.host.isEmpty || uri.hasQuery || uri.hasFragment || uri.userInfo.isNotEmpty) return null;
  const devHosts = {'localhost', '127.0.0.1', '10.0.2.2'};
  final allowed = uri.scheme == 'https' || (kDebugMode && uri.scheme == 'http' && devHosts.contains(uri.host));
  return allowed ? uri.toString() : null;
}

String get _userAgent {
  final os = Platform.operatingSystem;
  return 'r16a vault mobile (${os.isEmpty ? 'unknown' : '${os[0].toUpperCase()}${os.substring(1)}'})';
}

class ApiClient {
  ApiClient({required String baseUrl, required this.tokens, required void Function() onExpired})
    : dio = Dio(
        BaseOptions(
          baseUrl: '$baseUrl/api/v1',
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 30),
          // A readable name for the account's session list. Dart's default reveals nothing useful.
          headers: {'X-R16a-Request': '1', 'User-Agent': _userAgent},
          // Redirects could carry the bearer token to another host.
          followRedirects: false,
        ),
      ) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await tokens.read();
          if (token != null) options.headers['Authorization'] = 'Bearer $token';
          handler.next(options);
        },
        onError: (e, handler) {
          final data = e.response?.data;
          if (e.response?.statusCode == 401 && data is Map && data['type'] == 'urn:r16a:problem:unauthenticated') {
            onExpired();
          }
          handler.next(e);
        },
      ),
    );
  }

  final Dio dio;
  final TokenStore tokens;

  Future<Map<String, dynamic>> _json(Future<Response<dynamic>> request) async {
    try {
      final res = await request;
      final data = res.data;
      return data is Map<String, dynamic> ? data : <String, dynamic>{};
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  Future<Map<String, dynamic>> authConfig() => _json(dio.get('/auth/config'));

  Future<Prelogin> prelogin(String username) =>
      _json(dio.post('/auth/prelogin', data: {'username': username})).then(Prelogin.fromJson);

  Future<SignedIn> register({
    required String username,
    required String authKey,
    required KdfParams kdf,
    required String salt,
    required String wrappedVaultKey,
    String? oidcPendingToken,
  }) => _json(
    dio.post(
      '/auth/register',
      options: Options(headers: {'X-R16a-Oidc-Pending': ?oidcPendingToken}),
      data: {
        'username': username,
        'authKey': authKey,
        'kdf': kdf.toJson(),
        'salt': salt,
        'wrappedVaultKey': wrappedVaultKey,
        'client': 'mobile',
      },
    ),
  ).then(SignedIn.fromJson);

  Future<OidcExchange> oidcExchange(String code, String verifier) =>
      _json(dio.post('/auth/oidc/exchange', data: {'code': code, 'verifier': verifier})).then(OidcExchange.fromJson);

  Future<SignedIn> login(String username, String authKey) => _json(
    dio.post('/auth/login', data: {'username': username, 'authKey': authKey, 'client': 'mobile'}),
  ).then(SignedIn.fromJson);

  Future<Unlocked> unlock(String authKey) =>
      _json(dio.post('/auth/unlock', data: {'authKey': authKey})).then(Unlocked.fromJson);

  Future<void> logout() => _json(dio.post('/auth/logout'));

  Future<void> logoutAll(String authKey) => _json(dio.post('/auth/logout-all', data: {'authKey': authKey}));

  Future<Me> me() => _json(dio.get('/me')).then(Me.fromJson);

  Future<void> changeMasterPassword(Map<String, dynamic> body) => _json(dio.put('/me/master-password', data: body));

  Future<List<SessionInfo>> listSessions() async {
    try {
      final res = await dio.get<List<dynamic>>('/me/sessions');
      return [for (final row in res.data ?? const []) SessionInfo.fromJson(row as Map<String, dynamic>)];
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  Future<void> revokeSession(String id) => _json(dio.delete('/me/sessions/${Uri.encodeComponent(id)}'));

  Future<void> deleteAccount(String authKey) => _json(dio.delete('/me', data: {'authKey': authKey}));

  Future<List<CredentialRow>> listCredentials() async {
    try {
      final res = await dio.get<List<dynamic>>('/credentials');
      return [for (final row in res.data ?? const []) CredentialRow.fromJson(row as Map<String, dynamic>)];
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  Future<CredentialRow> createCredential(String id, String meta, String secret) =>
      _json(dio.post('/credentials', data: {'id': id, 'meta': meta, 'secret': secret})).then(CredentialRow.fromJson);

  Future<void> deleteCredential(String id) => _json(dio.delete('/credentials/${Uri.encodeComponent(id)}'));
}
