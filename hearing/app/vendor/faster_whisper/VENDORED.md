Vendored from faster-whisper 1.2.1 (https://github.com/SYSTRAN/faster-whisper), MIT License (see LICENSE).

Changes: import paths, and `import av` moved inside `decode_audio`, so the service does not need
PyAV (it always passes numpy arrays). onnxruntime is only imported by the VAD, which is unused.
Together this keeps the deployed function under the platform's 500 MB bundle limit.
