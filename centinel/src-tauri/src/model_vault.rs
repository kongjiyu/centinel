use std::path::Path;

const KEY_LENGTH: usize = 32;
pub type DeviceKey = [u8; KEY_LENGTH];

fn new_key() -> Result<DeviceKey, &'static str> {
    let mut key = [0; KEY_LENGTH];
    getrandom::getrandom(&mut key).map_err(|_| "Could not generate a device key.")?;
    Ok(key)
}

#[cfg(windows)]
pub fn load_key(home: &Path) -> Result<DeviceKey, &'static str> {
    use std::fs::{self, OpenOptions};
    use std::io::{ErrorKind, Write};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    fn transform(bytes: &mut [u8], protect: bool) -> Result<Vec<u8>, &'static str> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_mut_ptr(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        // DPAPI owns the returned buffer. The local copy is made before it is freed.
        unsafe {
            use std::ptr::{null, null_mut};
            let ok = if protect {
                CryptProtectData(
                    &input,
                    null(),
                    null(),
                    null(),
                    null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    null_mut(),
                    null(),
                    null(),
                    null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            };
            if ok == 0 || output.pbData.is_null() {
                return Err("Windows could not protect or unlock the device key.");
            }
            let buffer = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
            let result = buffer.to_vec();
            buffer.fill(0);
            LocalFree(output.pbData.cast());
            Ok(result)
        }
    }

    let target = home.join("model-vault-key.dpapi");
    match fs::read(&target) {
        Ok(mut data) => {
            return transform(&mut data, false)?
                .try_into()
                .map_err(|_| "Invalid device key length.")
        }
        Err(error) if error.kind() == ErrorKind::NotFound => (),
        Err(_) => return Err("Could not read the protected device key."),
    }
    let mut key = new_key()?;
    let data = transform(&mut key, true)?;
    key.fill(0);
    let nonce = new_key()?[..8]
        .iter()
        .fold(String::new(), |prefix, byte| format!("{prefix}{byte:02x}"));
    let staging = home.join(format!(".model-vault-key-{nonce}.partial"));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&staging)
        .map_err(|_| "Could not stage the protected device key.")?;
    let staged = file.write_all(&data).and_then(|_| file.sync_all());
    drop(file);
    // Publish without replacing another process's key, even if both launch at once.
    let published = staged.and_then(|_| fs::hard_link(&staging, &target));
    let _ = fs::remove_file(&staging);
    match published {
        Ok(()) => (),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => (),
        Err(_) => return Err("Could not save the protected device key."),
    }
    let mut saved = fs::read(target).map_err(|_| "Could not read the saved device key.")?;
    transform(&mut saved, false)?
        .try_into()
        .map_err(|_| "Invalid device key length.")
}

#[cfg(target_os = "macos")]
pub fn load_key(_home: &Path) -> Result<DeviceKey, &'static str> {
    use security_framework::os::macos::keychain::SecKeychain;
    const SERVICE: &str = "com.centinel.app.model-vault";
    const ACCOUNT: &str = "device-key-v1";
    const NOT_FOUND: i32 = -25300;
    const DUPLICATE: i32 = -25299;
    let keychain = SecKeychain::default().map_err(|_| "Could not open the login Keychain.")?;
    match keychain.find_generic_password(SERVICE, ACCOUNT) {
        Ok((password, _)) => {
            return (&*password)
                .try_into()
                .map_err(|_| "Invalid Keychain device key length.")
        }
        Err(error) if error.code() == NOT_FOUND => (),
        Err(_) => return Err("Could not unlock the device key from Keychain."),
    }
    let mut key = new_key()?;
    let saved = keychain.add_generic_password(SERVICE, ACCOUNT, &key);
    key.fill(0);
    if saved.as_ref().is_err_and(|error| error.code() != DUPLICATE) {
        return Err("Could not save the device key in Keychain.");
    }
    let (password, _) = keychain
        .find_generic_password(SERVICE, ACCOUNT)
        .map_err(|_| "Could not reopen the device key from Keychain.")?;
    (&*password)
        .try_into()
        .map_err(|_| "Invalid Keychain device key length.")
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn load_key(_home: &Path) -> Result<DeviceKey, &'static str> {
    Err("OS-protected model credentials are unavailable on this platform.")
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn windows_reopens_the_same_protected_key() {
        let nonce = new_key().unwrap()[..8]
            .iter()
            .fold(String::new(), |prefix, byte| format!("{prefix}{byte:02x}"));
        let home = std::env::temp_dir().join(format!("centinel-model-vault-{nonce}"));
        std::fs::create_dir(&home).unwrap();
        let first = load_key(&home).unwrap();
        let reopened = load_key(&home).unwrap();
        let path = home.join("model-vault-key.dpapi");
        let ciphertext = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(home).unwrap();
        assert!(first == reopened, "The device key changed on reopening.");
        assert!(
            ciphertext != first,
            "The device key was saved in plaintext."
        );
    }
}
