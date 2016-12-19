{
    'includes': ['common.gypi'],
    'targets': [{
        'target_name': 'native_core',
        'dependencies': [
            'third_party/base64/base64.gyp:base64',
            'third_party/crc32/crc32.gyp:crc32',
            'third_party/libutp/libutp.gyp:libutp',
            'third_party/snappy/snappy.gyp:snappy',
            'third_party/zlib/zlib.gyp:zlib',
            # 'third_party/crc32/crc32.gyp:runcrc',
            # 'third_party/libutp/libutp.gyp:ucat',
            # 'third_party/udt4/udt4.gyp:udt4',
        ],
        'sources': [
            'coding/dedup.h',
            'coding/dedup.hpp',
            'coding/dedup_chunker.cpp',
            'coding/dedup_chunker.h',
            'coding/dedup_config.cpp',
            'coding/dedup_config.h',
            'coding/object_coding.cpp',
            'coding/object_coding.h',
            'n2n/nat.cpp',
            'n2n/nat.h',
            'n2n/ntcp.cpp',
            'n2n/ntcp.h',
            'n2n/nudp.cpp',
            'n2n/nudp.h',
            'util/backtrace.h',
            'util/buf.cpp',
            'util/buf.h',
            'util/buzhash.cpp',
            'util/buzhash.h',
            'util/common.h',
            'util/compression.cpp',
            'util/compression.h',
            'util/crypto.cpp',
            'util/crypto.h',
            'util/gf2.cpp',
            'util/gf2.h',
            'util/mutex.h',
            'util/rabin_fingerprint.h',
            'util/rabin_karp.h',
            'util/syslog.h',
            'util/syslog.cpp',
            'util/signup_validator.h',
            'util/signup_validator.cpp',
            'util/tpool.cpp',
            'util/tpool.h',
            'module.cpp',
        ],
    }]
}
