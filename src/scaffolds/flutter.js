function pubspec(packageName) {
  return `name: ${packageName}
description: Agent-ready Flutter starter with local Agent Skills.
publish_to: "none"
version: 0.1.0+1

environment:
  sdk: ">=3.8.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^6.0.0

flutter:
  uses-material-design: true
`;
}

const analysisOptions = `include: package:flutter_lints/flutter.yaml

linter:
  rules:
    avoid_print: true
    prefer_final_locals: true
    prefer_final_in_for_each: true
`;

const domain = `sealed class CounterAction {
  const CounterAction();
}

final class IncrementCounter extends CounterAction {
  const IncrementCounter();
}

final class DecrementCounter extends CounterAction {
  const DecrementCounter();
}

final class ResetCounter extends CounterAction {
  const ResetCounter();
}

final class CounterState {
  const CounterState({required this.value});

  final int value;
}

const initialCounterState = CounterState(value: 0);

CounterState reduceCounter(CounterState state, CounterAction action) {
  return switch (action) {
    IncrementCounter() => CounterState(value: state.value + 1),
    DecrementCounter() => CounterState(value: state.value - 1),
    ResetCounter() => initialCounterState,
  };
}
`;

function viewModel(domainImport) {
  return `import 'package:flutter/foundation.dart';

import '${domainImport}';

final class CounterViewModel extends ChangeNotifier {
  CounterState _state = initialCounterState;

  int get value => _state.value;

  void dispatch(CounterAction action) {
    _state = reduceCounter(_state, action);
    notifyListeners();
  }
}
`;
}

function page(packageName, domainImport, viewModelImport) {
  return `import 'package:flutter/material.dart';
import 'package:${packageName}/${domainImport}';
import 'package:${packageName}/${viewModelImport}';

class CounterPage extends StatefulWidget {
  const CounterPage({super.key, this.viewModel});

  final CounterViewModel? viewModel;

  @override
  State<CounterPage> createState() => _CounterPageState();
}

class _CounterPageState extends State<CounterPage> {
  late final CounterViewModel _viewModel;
  late final bool _ownsViewModel;

  @override
  void initState() {
    super.initState();
    _ownsViewModel = widget.viewModel == null;
    _viewModel = widget.viewModel ?? CounterViewModel();
  }

  @override
  void dispose() {
    if (_ownsViewModel) _viewModel.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Counter')),
      body: Center(
        child: AnimatedBuilder(
          animation: _viewModel,
          builder: (context, _) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Value: \${_viewModel.value}',
                  key: const Key('counter-value'),
                  style: Theme.of(context).textTheme.displaySmall,
                ),
                const SizedBox(height: 24),
                Wrap(
                  spacing: 12,
                  children: [
                    FilledButton.tonal(
                      onPressed: () => _viewModel.dispatch(const DecrementCounter()),
                      child: const Text('Decrease'),
                    ),
                    FilledButton(
                      onPressed: () => _viewModel.dispatch(const IncrementCounter()),
                      child: const Text('Increase'),
                    ),
                    TextButton(
                      onPressed: () => _viewModel.dispatch(const ResetCounter()),
                      child: const Text('Reset'),
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
`;
}

function main(packageName, pageImport) {
  return `import 'package:flutter/material.dart';
import 'package:${packageName}/${pageImport}';

void main() {
  runApp(const App());
}

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Agentic Flutter Starter',
      theme: ThemeData(colorSchemeSeed: Colors.indigo),
      home: const CounterPage(),
    );
  }
}
`;
}

function domainTest(packageName, domainImport) {
  return `import 'package:flutter_test/flutter_test.dart';
import 'package:${packageName}/${domainImport}';

void main() {
  test('increment returns a new state and leaves the previous value unchanged', () {
    const previous = initialCounterState;

    final next = reduceCounter(previous, const IncrementCounter());

    expect(next.value, 1);
    expect(previous.value, 0);
  });
}
`;
}

function widgetTest(packageName, pageImport) {
  return `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:${packageName}/${pageImport}';

void main() {
  testWidgets('increments when the user taps Increase', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: CounterPage()),
    );

    await tester.tap(find.text('Increase'));
    await tester.pump();

    expect(find.text('Value: 1'), findsOneWidget);
  });
}
`;
}

function paths(style) {
  if (style === "simple") {
    return {
      domain: "lib/features/counter/counter.dart",
      viewModel: "lib/features/counter/counter_view_model.dart",
      page: "lib/features/counter/counter_page.dart",
      domainFromViewModel: "counter.dart",
      domainPackage: "features/counter/counter.dart",
      viewModelPackage: "features/counter/counter_view_model.dart",
      pagePackage: "features/counter/counter_page.dart",
      domainTest: "test/features/counter/counter_test.dart",
      pageTest: "test/features/counter/counter_page_test.dart",
    };
  }
  if (style === "clean") {
    return {
      domain: "lib/domain/counter.dart",
      viewModel: "lib/application/counter_view_model.dart",
      page: "lib/presentation/counter_page.dart",
      domainFromViewModel: "../domain/counter.dart",
      domainPackage: "domain/counter.dart",
      viewModelPackage: "application/counter_view_model.dart",
      pagePackage: "presentation/counter_page.dart",
      domainTest: "test/domain/counter_test.dart",
      pageTest: "test/presentation/counter_page_test.dart",
    };
  }
  return {
    domain: "lib/features/counter/domain/counter.dart",
    viewModel: "lib/features/counter/application/counter_view_model.dart",
    page: "lib/features/counter/presentation/counter_page.dart",
    domainFromViewModel: "../domain/counter.dart",
    domainPackage: "features/counter/domain/counter.dart",
    viewModelPackage: "features/counter/application/counter_view_model.dart",
    pagePackage: "features/counter/presentation/counter_page.dart",
    domainTest: "test/features/counter/domain/counter_test.dart",
    pageTest: "test/features/counter/presentation/counter_page_test.dart",
  };
}

export function flutterScaffold({ packageName, style }) {
  const p = paths(style);
  return {
    "pubspec.yaml": pubspec(packageName),
    "analysis_options.yaml": analysisOptions,
    ".gitignore": `.dart_tool/\n.packages\n.pub/\nbuild/\ncoverage/\n.env\n.DS_Store\n`,
    "lib/main.dart": main(packageName, p.pagePackage),
    [p.domain]: domain,
    [p.viewModel]: viewModel(p.domainFromViewModel),
    [p.page]: page(packageName, p.domainPackage, p.viewModelPackage),
    [p.domainTest]: domainTest(packageName, p.domainPackage),
    [p.pageTest]: widgetTest(packageName, p.pagePackage),
  };
}

export function flutterStructure(style) {
  if (style === "simple") {
    return `lib/\n├── features/counter/\n│   ├── counter.dart\n│   ├── counter_view_model.dart\n│   └── counter_page.dart\n└── main.dart\ntest/`;
  }
  if (style === "clean") {
    return `lib/\n├── domain/\n├── application/\n├── presentation/\n└── main.dart\ntest/`;
  }
  return `lib/\n├── features/counter/\n│   ├── domain/\n│   ├── application/\n│   └── presentation/\n└── main.dart\ntest/`;
}
