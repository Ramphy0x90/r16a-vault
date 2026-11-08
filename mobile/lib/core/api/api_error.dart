import 'package:dio/dio.dart';

import '../crypto/protocol.dart';

/// A failed request reduced to the stable problem slug. Server text is never shown.
class ApiError implements Exception {
  const ApiError(this.status, this.slug, this.retryAfter);

  final int status;
  final String slug;
  final int? retryAfter;

  factory ApiError.from(Object e) {
    if (e is ApiError) return e;
    if (e is DioException) {
      final res = e.response;
      if (res == null) return const ApiError(0, 'network', null);
      final data = res.data;
      final type = data is Map ? data['type'] : null;
      final slug = type is String ? type.replaceFirst('urn:r16a:problem:', '') : 'unknown';
      return ApiError(res.statusCode ?? 0, slug, int.tryParse(res.headers.value('retry-after') ?? ''));
    }
    return const ApiError(0, 'unknown', null);
  }

  @override
  String toString() => 'ApiError($status, $slug)';
}

String messageFor(Object e) {
  if (e is CryptoError) {
    return switch (e.code) {
      CryptoErrorCode.kdfRejected => 'The server sent unsafe security settings, so sign in was stopped.',
      _ => 'Your vault data could not be decrypted.',
    };
  }
  final err = e is ApiError ? e : (e is DioException ? ApiError.from(e) : null);
  if (err == null) return 'Something went wrong. Please try again.';
  return switch (err.slug) {
    'invalid-credentials' => 'The username or master password is incorrect.',
    'too-many-requests' =>
      err.retryAfter != null
          ? 'Too many attempts. Try again in ${err.retryAfter} seconds.'
          : 'Too many attempts. Please wait a moment.',
    'username-taken' => 'That username is already taken.',
    'invalid-username' => 'Usernames are 3 to 64 letters, digits, dots, hyphens or underscores.',
    'registration-disabled' => 'New accounts are disabled on this server.',
    'unauthenticated' => 'Your session has ended. Please sign in again.',
    'network' => 'The server could not be reached. Check the address and your connection.',
    'credential-limit' => 'This vault has reached its maximum number of entries.',
    _ => err.status >= 500 ? 'The server had a problem. Please try again.' : 'The request could not be completed.',
  };
}
