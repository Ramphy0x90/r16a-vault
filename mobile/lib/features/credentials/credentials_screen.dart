import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/theme/theme.dart';
import 'credential_details_sheet.dart';
import 'credential_tile.dart';
import 'credentials_controller.dart';

class CredentialsScreen extends ConsumerStatefulWidget {
  const CredentialsScreen({super.key});

  @override
  ConsumerState<CredentialsScreen> createState() => _CredentialsScreenState();
}

class _CredentialsScreenState extends ConsumerState<CredentialsScreen> {
  String _query = '';

  List<CredentialEntry> _filter(List<CredentialEntry> list) {
    final q = _query.trim().toLowerCase();
    final sorted = [...list]
      ..sort((a, b) => (a.meta?.name ?? '').toLowerCase().compareTo((b.meta?.name ?? '').toLowerCase()));
    if (q.isEmpty) return sorted;
    return sorted.where((e) {
      final m = e.meta;
      return m != null && [m.name, m.username, m.url ?? ''].any((f) => f.toLowerCase().contains(q));
    }).toList();
  }

  void _open(CredentialEntry e) {
    if (e.meta == null) return;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => CredentialDetailsSheet(id: e.id, meta: e.meta!),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(credentialsProvider);
    final muted = Theme.of(context).extension<Tokens>()!.textMuted;
    return Scaffold(
      appBar: AppBar(title: const Text('Vault')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/vault/add'),
        icon: const Icon(Icons.add),
        label: const Text('Add'),
      ),
      body: switch (state) {
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(messageFor(error), textAlign: TextAlign.center),
                const SizedBox(height: 12),
                OutlinedButton(onPressed: () => ref.invalidate(credentialsProvider), child: const Text('Try again')),
              ],
            ),
          ),
        ),
        AsyncData(:final value) when value.isEmpty => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.key_outlined, size: 40, color: muted),
                const SizedBox(height: 12),
                Text('Your vault is empty', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(
                  'Add your first login. It is encrypted on this device before it is saved.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: muted),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: () => context.go('/vault/add'),
                  icon: const Icon(Icons.add),
                  label: const Text('Add credential'),
                ),
              ],
            ),
          ),
        ),
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () => ref.refresh(credentialsProvider.future),
          child: ListView(
            padding: const EdgeInsets.only(bottom: 96),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: TextField(
                  decoration: const InputDecoration(prefixIcon: Icon(Icons.search), labelText: 'Search credentials'),
                  onChanged: (v) => setState(() => _query = v),
                ),
              ),
              for (final e in _filter(value)) CredentialTile(entry: e, onTap: () => _open(e)),
              if (_filter(value).isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('No credentials match "$_query".', style: TextStyle(color: muted)),
                ),
            ],
          ),
        ),
        _ => Center(
          child: Semantics(label: 'Decrypting your vault', child: const CircularProgressIndicator()),
        ),
      },
    );
  }
}
