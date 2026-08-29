#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Scope {
    Root,
    Module,
    Affected,
    All,
}

#[derive(Clone, Debug)]
pub struct Options {
    pub root: String,
    pub timeout_ms: u64,
    pub scope: Scope,
    pub modules: Vec<String>,
    pub affected_from: Option<String>,
    pub concurrency: usize,
}

pub fn parse(args: &[String]) -> Result<Options, String> {
    let mut root = None;
    let mut timeout_ms = 120_000_u64;
    let mut scope = Scope::Root;
    let mut modules = Vec::new();
    let mut affected_from = None;
    let mut concurrency = 1_usize;
    let (mut timeout_seen, mut scope_seen, mut concurrency_seen) = (false, false, false);
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--timeout" => {
                if timeout_seen {
                    return Err("duplicate verify option: --timeout".to_owned());
                }
                timeout_seen = true;
                index += 1;
                timeout_ms = args
                    .get(index)
                    .and_then(|value| value.parse().ok())
                    .filter(|value| *value > 0)
                    .ok_or_else(|| "--timeout requires positive milliseconds".to_owned())?;
            }
            "--scope" => {
                if scope_seen {
                    return Err("duplicate verify option: --scope".to_owned());
                }
                scope_seen = true;
                index += 1;
                scope = match args.get(index).map(String::as_str) {
                    Some("root") => Scope::Root,
                    Some("module") => Scope::Module,
                    Some("affected") => Scope::Affected,
                    Some("all") => Scope::All,
                    _ => return Err("--scope requires root, module, affected, or all".to_owned()),
                };
            }
            "--module" => {
                index += 1;
                modules.push(
                    args.get(index)
                        .filter(|value| !value.starts_with('-'))
                        .ok_or_else(|| "--module requires an ID".to_owned())?
                        .clone(),
                );
            }
            "--affected-from" => {
                if affected_from.is_some() {
                    return Err("duplicate verify option: --affected-from".to_owned());
                }
                index += 1;
                affected_from = Some(
                    args.get(index)
                        .filter(|value| !value.starts_with('-'))
                        .ok_or_else(|| "--affected-from requires a Git ref".to_owned())?
                        .clone(),
                );
            }
            "--concurrency" => {
                if concurrency_seen {
                    return Err("duplicate verify option: --concurrency".to_owned());
                }
                concurrency_seen = true;
                index += 1;
                concurrency = args
                    .get(index)
                    .and_then(|value| value.parse().ok())
                    .filter(|value| (1..=8).contains(value))
                    .ok_or_else(|| {
                        "--concurrency requires an integer from 1 through 8".to_owned()
                    })?;
            }
            option if option.starts_with('-') => {
                return Err(format!("unknown verify option: {option}"))
            }
            value if root.is_none() => root = Some(value.to_owned()),
            value => return Err(format!("unexpected verify positional: {value}")),
        }
        index += 1;
    }
    modules.sort();
    modules.dedup();
    if scope == Scope::Module && modules.is_empty() {
        return Err("--scope module requires at least one --module".to_owned());
    }
    if scope != Scope::Module && !modules.is_empty() {
        return Err("--module is valid only with --scope module".to_owned());
    }
    if scope != Scope::Affected && affected_from.is_some() {
        return Err("--affected-from is valid only with --scope affected".to_owned());
    }
    Ok(Options {
        root: root.unwrap_or_else(|| ".".to_owned()),
        timeout_ms,
        scope,
        modules,
        affected_from,
        concurrency,
    })
}

#[cfg(test)]
mod tests {
    use super::{parse, Scope};
    #[test]
    fn parses_affected_verification_options() {
        let options = parse(&[
            "repo".into(),
            "--scope".into(),
            "affected".into(),
            "--concurrency".into(),
            "4".into(),
        ])
        .unwrap();
        assert_eq!(options.root, "repo");
        assert_eq!(options.scope, Scope::Affected);
        assert_eq!(options.concurrency, 4);
    }
}
