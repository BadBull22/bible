//! Content Factory: put saved pictures and videos on the clipboard as FILES (so they paste into WhatsApp Web, Facebook's upload box or
//! an e-mail), and open the Windows Share window for them (WhatsApp, Mail, Nearby sharing and whatever else the computer offers).
//! Only files inside Documents\Bible Concordance\Content Factory.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn inside_factory(app: &AppHandle, paths: &[String]) -> Result<Vec<PathBuf>, String> {
    let root = app.path().document_dir().map_err(|e| e.to_string())?.join("Bible Concordance").join("Content Factory");
    if paths.is_empty() || paths.len() > 40 {
        return Err("Nothing to share.".into());
    }
    let mut out = Vec::new();
    for p in paths {
        let path = PathBuf::from(p);
        if !path.starts_with(&root) || !path.is_file() {
            return Err("That file is not in the Content Factory folder.".into());
        }
        out.push(path);
    }
    Ok(out)
}

/// Puts the files on the clipboard the way Explorer's Copy does.
#[tauri::command]
pub fn factory_copy_files(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let files = inside_factory(&app, &paths)?;
    #[cfg(windows)]
    {
        win::copy_files(&files)
    }
    #[cfg(not(windows))]
    {
        let _ = files;
        Err("Copying files is only available on Windows.".into())
    }
}

/// Opens the Windows Share window for the files.
#[tauri::command]
pub async fn factory_share(app: AppHandle, paths: Vec<String>, title: String, text: String) -> Result<(), String> {
    let files = inside_factory(&app, &paths)?;
    #[cfg(windows)]
    {
        win::share(&app, files, title, text).await
    }
    #[cfg(not(windows))]
    {
        let _ = (files, title, text);
        Err("The Share window is only available on Windows.".into())
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{factory, AgileReference, Interface, HSTRING};
    use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
    use windows::Foundation::TypedEventHandler;
    use windows_collections::IIterable;
    use windows::Storage::{IStorageItem, StorageFile};
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT};
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::{IDataTransferManagerInterop, DROPFILES};

    pub fn copy_files(files: &[PathBuf]) -> Result<(), String> {
        // the list of full names, each ending in a zero, the whole list ending in a second zero
        let mut wide: Vec<u16> = Vec::new();
        for f in files {
            wide.extend(f.as_os_str().encode_wide());
            wide.push(0);
        }
        wide.push(0);
        let head = std::mem::size_of::<DROPFILES>();
        let size = head + wide.len() * 2;
        unsafe {
            let mem = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size).map_err(|e| e.to_string())?;
            let ptr = GlobalLock(mem) as *mut u8;
            if ptr.is_null() {
                return Err("The clipboard could not be filled.".into());
            }
            let drop = ptr as *mut DROPFILES;
            (*drop).pFiles = head as u32;
            (*drop).fWide = true.into();
            std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr.add(head), wide.len() * 2);
            let _ = GlobalUnlock(mem);
            OpenClipboard(None).map_err(|e| e.to_string())?;
            let result = (|| -> Result<(), String> {
                EmptyClipboard().map_err(|e| e.to_string())?;
                SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(mem.0))).map_err(|e| e.to_string())?;
                Ok(())
            })();
            let _ = CloseClipboard();
            result
        }
    }

    thread_local! {
        /// the handler of the last share, taken off before the next so that two shares never answer one request
        static LAST: std::cell::RefCell<Option<(DataTransferManager, i64)>> = const { std::cell::RefCell::new(None) };
    }

    fn show(hwnd: HWND, files: Vec<AgileReference<StorageFile>>, title: String, text: String) -> Result<(), String> {
        let e = |e: windows::core::Error| e.to_string();
        let interop = factory::<DataTransferManager, IDataTransferManagerInterop>().map_err(e)?;
        let dtm: DataTransferManager = unsafe { interop.GetForWindow(hwnd) }.map_err(e)?;
        LAST.with(|l| {
            if let Some((old, token)) = l.borrow_mut().take() {
                let _ = old.RemoveDataRequested(token);
            }
        });
        let token = dtm
            .DataRequested(&TypedEventHandler::new(move |_, args: windows::core::Ref<'_, DataRequestedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let data = args.Request()?.Data()?;
                    data.Properties()?.SetTitle(&HSTRING::from(title.as_str()))?;
                    if !text.is_empty() {
                        data.SetText(&HSTRING::from(text.as_str()))?;
                    }
                    let items: Vec<Option<IStorageItem>> = files.iter().filter_map(|f| f.resolve().ok()).filter_map(|f| f.cast::<IStorageItem>().ok()).map(Some).collect();
                    let iterable: IIterable<IStorageItem> = items.into();
                    data.SetStorageItemsReadOnly(&iterable)?;
                }
                Ok(())
            }))
            .map_err(e)?;
        LAST.with(|l| *l.borrow_mut() = Some((dtm, token)));
        unsafe { interop.ShowShareUIForWindow(hwnd) }.map_err(e)
    }

    pub async fn share(app: &AppHandle, paths: Vec<PathBuf>, title: String, text: String) -> Result<(), String> {
        let window = app.get_webview_window("main").ok_or("The app window was not found.")?;
        // the window's handle as a plain number (a raw handle cannot be held across the waits below)
        let hwnd_raw = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        // the files are looked up first, on a thread of their own, so that the window's thread is never kept waiting
        let files = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<AgileReference<StorageFile>>, String> {
            let mut out = Vec::new();
            for p in paths {
                let name = HSTRING::from(p.as_os_str());
                let file = StorageFile::GetFileFromPathAsync(&name).map_err(|e| e.to_string())?.get().map_err(|e| e.to_string())?;
                out.push(AgileReference::new(&file).map_err(|e| e.to_string())?);
            }
            Ok(out)
        })
        .await
        .map_err(|e| e.to_string())??;
        // the Share window belongs to the window's own thread
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);
            let _ = tx.send(show(hwnd, files, title, text));
        })
        .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?).await.map_err(|e| e.to_string())?
    }
}
