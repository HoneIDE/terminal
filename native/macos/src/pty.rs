//! PTY management: forkpty, read, write, resize, close.

use std::ffi::CString;

/// Open a new PTY and spawn a shell process.
/// Returns (master_fd, child_pid) on success, (-1, -1) on failure.
pub fn open_pty(shell: &str, rows: u16, cols: u16, cwd: &str) -> (i32, i32) {
    unsafe {
        let mut ws: libc::winsize = std::mem::zeroed();
        ws.ws_row = rows;
        ws.ws_col = cols;
        ws.ws_xpixel = 0;
        ws.ws_ypixel = 0;

        let mut master_fd: i32 = -1;
        let pid = libc::forkpty(
            &mut master_fd as *mut i32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut ws as *mut libc::winsize,
        );

        if pid < 0 {
            return (-1, -1);
        }

        if pid == 0 {
            // Child process
            // Set environment
            let term = CString::new("TERM=xterm-256color").unwrap();
            libc::putenv(term.as_ptr() as *mut _);
            let colorterm = CString::new("COLORTERM=truecolor").unwrap();
            libc::putenv(colorterm.as_ptr() as *mut _);

            // Change to working directory
            if !cwd.is_empty() {
                let cwd_c = CString::new(cwd).unwrap();
                libc::chdir(cwd_c.as_ptr());
            }

            // Execute shell
            let shell_c = CString::new(shell).unwrap();
            let login_arg = CString::new("-l").unwrap();
            let args = [shell_c.as_ptr(), login_arg.as_ptr(), std::ptr::null()];
            libc::execvp(shell_c.as_ptr(), args.as_ptr());

            // If execvp returns, it failed
            libc::_exit(1);
        }

        // Parent process — set non-blocking on master fd
        let flags = libc::fcntl(master_fd, libc::F_GETFL);
        libc::fcntl(master_fd, libc::F_SETFL, flags | libc::O_NONBLOCK);

        (master_fd, pid)
    }
}

/// Non-blocking read from PTY master fd.
/// Returns number of bytes read, 0 if nothing available, -1 on error/EOF.
pub fn pty_read(master_fd: i32, buf: &mut [u8]) -> isize {
    unsafe {
        let n = libc::read(
            master_fd,
            buf.as_mut_ptr() as *mut libc::c_void,
            buf.len(),
        );
        if n < 0 {
            let err = *libc::__error();
            if err == libc::EAGAIN || err == libc::EWOULDBLOCK {
                return 0; // Nothing available
            }
            return -1; // Real error
        }
        n
    }
}

/// Write data to PTY master fd.
pub fn pty_write(master_fd: i32, data: &[u8]) {
    unsafe {
        let mut written = 0usize;
        while written < data.len() {
            let n = libc::write(
                master_fd,
                data[written..].as_ptr() as *const libc::c_void,
                data.len() - written,
            );
            if n <= 0 {
                break;
            }
            written += n as usize;
        }
    }
}

/// Resize the PTY window.
pub fn pty_resize(master_fd: i32, rows: u16, cols: u16) {
    unsafe {
        let mut ws: libc::winsize = std::mem::zeroed();
        ws.ws_row = rows;
        ws.ws_col = cols;
        libc::ioctl(master_fd, libc::TIOCSWINSZ, &ws as *const libc::winsize);
    }
}

/// Close the PTY and terminate the child process.
pub fn pty_close(master_fd: i32, pid: i32) {
    unsafe {
        libc::kill(pid, libc::SIGTERM);
        libc::close(master_fd);
        // Reap child to avoid zombies
        let mut status: i32 = 0;
        libc::waitpid(pid, &mut status, libc::WNOHANG);
    }
}

/// Check if the child process is still alive.
pub fn pty_child_alive(pid: i32) -> bool {
    unsafe {
        let mut status: i32 = 0;
        let result = libc::waitpid(pid, &mut status, libc::WNOHANG);
        result == 0 // 0 means still running
    }
}
