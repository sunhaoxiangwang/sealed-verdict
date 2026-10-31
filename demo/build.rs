// With `--features py` on macOS, framework Pythons (Xcode / python.org) link via @rpath; add the framework dir.
fn main() {
    if std::env::var_os("CARGO_FEATURE_PY").is_none() || std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let py = std::env::var("PYO3_PYTHON").unwrap_or("python3".into());
    let out = std::process::Command::new(py).args(["-c", "import sysconfig; print(sysconfig.get_config_var('PYTHONFRAMEWORKPREFIX') or '')"]).output();
    if let Ok(dir) = out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()) {
        if !dir.is_empty() {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{dir}");
        }
    }
}
