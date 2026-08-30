use std::{
    io::{self, Cursor, Write},
    ops::Range,
};

use azalea_buf::{AzBuf, BufReadError};

/// Represents Java's BitSet, a list of bits.
#[derive(AzBuf, Clone, Debug, Default, Eq, Hash, PartialEq)]
pub struct BitSet {
    data: Box<[u64]>,
}

const LOG2_BITS_PER_WORD: usize = 6;

impl BitSet {
    #[inline]
    pub fn new(num_bits: usize) -> Self {
        BitSet {
            data: vec![0; num_bits.div_ceil(64)].into(),
        }
    }

    #[inline]
    pub fn index(&self, index: usize) -> bool {
        self.get(index).unwrap_or_else(|| {
            let len = self.len();
            panic!("index out of bounds: the len is {len} but the index is {index}")
        })
    }

    #[inline]
    pub fn get(&self, index: usize) -> Option<bool> {
        self.data
            .get(index / 64)
            .map(|word| (word & (1u64 << (index % 64))) != 0)
    }

    pub fn clear(&mut self, range: Range<usize>) {
        assert!(
            range.start <= range.end,
            "Range ends before it starts; {} must be less than or equal to {}",
            range.start,
            range.end
        );

        let from_idx = range.start;
        let mut to_idx = range.end;

        if from_idx == to_idx {
            return;
        }

        let start_word_idx = self.word_index(from_idx);
        if start_word_idx >= self.data.len() {
            return;
        }

        let mut end_word_idx = self.word_index(to_idx - 1);
        if end_word_idx >= self.data.len() {
            to_idx = self.len();
            end_word_idx = self.data.len() - 1;
        }

        let first_word_mask = u64::MAX.wrapping_shl(
            from_idx
                .try_into()
                .expect("from_index shouldn't be larger than u32"),
        );
        let last_word_mask = u64::MAX.wrapping_shr((64 - (to_idx % 64)) as u32);
        if start_word_idx == end_word_idx {
            self.data[start_word_idx] &= !(first_word_mask & last_word_mask);
        } else {
            self.data[start_word_idx] &= !first_word_mask;
            for i in (start_word_idx + 1)..end_word_idx {
                self.data[i] = 0;
            }
            self.data[end_word_idx] &= !last_word_mask;
        }
    }

    pub fn next_clear_bit(&self, from_index: usize) -> usize {
        let mut u = self.word_index(from_index);
        if u >= self.data.len() {
            return from_index;
        }

        let mut word = !self.data[u] & (u64::MAX.wrapping_shl(from_index.try_into().unwrap()));

        loop {
            if word != 0 {
                return (u * 64) + word.trailing_zeros() as usize;
            }
            u += 1;
            if u == self.data.len() {
                return self.data.len() * 64;
            }
            word = !self.data[u];
        }
    }

    #[inline]
    fn word_index(&self, bit_index: usize) -> usize {
        bit_index >> LOG2_BITS_PER_WORD
    }

    #[inline]
    pub fn set(&mut self, bit_index: usize) {
        self.data[bit_index / 64] |= 1u64 << (bit_index % 64);
    }

    pub fn iter_ones(&self) -> impl Iterator<Item = usize> {
        (0..self.len()).filter(|i| self.index(*i))
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.data.len() * 64
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl From<Vec<u64>> for BitSet {
    fn from(data: Vec<u64>) -> Self {
        BitSet { data: data.into() }
    }
}

impl From<Vec<u8>> for BitSet {
    fn from(data: Vec<u8>) -> Self {
        let mut words = vec![0; data.len().div_ceil(8)];
        for (i, byte) in data.iter().enumerate() {
            words[i / 8] |= (*byte as u64) << ((i % 8) * 8);
        }
        BitSet { data: words.into() }
    }
}

/// Fixed-size bitset - FIXED VERSION that avoids E0284
/// Uses Vec<u8> internally to avoid generic_const_exprs
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct FixedBitSet<const N: usize> {
    data: Vec<u8>,
}

impl<const N: usize> FixedBitSet<N> {
    pub fn new() -> Self {
        FixedBitSet {
            data: vec![0; Self::bytes_len()],
        }
    }

    pub fn new_with_data(data: Vec<u8>) -> Self {
        let mut d = vec![0; Self::bytes_len()];
        let len = d.len().min(data.len());
        d[..len].copy_from_slice(&data[..len]);
        FixedBitSet { data: d }
    }

    // Keep old signature for compatibility - takes array but converts to Vec
    pub fn new_with_array<const M: usize>(data: [u8; M]) -> Self {
        Self::new_with_data(data.to_vec())
    }

    const fn bytes_len() -> usize {
        (N + 7) / 8
    }

    #[inline]
    pub fn index(&self, index: usize) -> bool {
        if index >= N {
            return false;
        }
        (self.data[index / 8] & (1u8 << (index % 8))) != 0
    }

    #[inline]
    pub fn set(&mut self, bit_index: usize) {
        if bit_index < N {
            self.data[bit_index / 8] |= 1u8 << (bit_index % 8);
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.data
    }
}

// Compatibility: allow [u8; bits_to_bytes(N)] where clause via const fn
pub const fn bits_to_bytes(n: usize) -> usize {
    (n + 7) / 8
}

impl<const N: usize> AzBuf for FixedBitSet<N> {
    fn azalea_read(buf: &mut Cursor<&[u8]>) -> Result<Self, BufReadError> {
        let bytes = bits_to_bytes(N);
        let mut data = vec![0u8; bytes];
        for i in 0..bytes {
            data[i] = u8::azalea_read(buf)?;
        }
        Ok(FixedBitSet { data })
    }

    fn azalea_write(&self, buf: &mut impl Write) -> io::Result<()> {
        for b in &self.data {
            b.azalea_write(buf)?;
        }
        Ok(())
    }
}

impl<const N: usize> Default for FixedBitSet<N> {
    fn default() -> Self {
        Self::new()
    }
}

/// Faster version using u64
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct FastFixedBitSet<const N: usize> {
    data: Vec<u64>,
}

impl<const N: usize> FastFixedBitSet<N> {
    pub fn new() -> Self {
        FastFixedBitSet {
            data: vec![0; Self::longs_len()],
        }
    }

    const fn longs_len() -> usize {
        (N + 63) / 64
    }

    #[inline]
    pub fn index(&self, index: usize) -> bool {
        if index >= N {
            return false;
        }
        (self.data[index / 64] & (1u64 << (index % 64))) != 0
    }

    #[inline]
    pub fn set(&mut self, bit_index: usize) {
        if bit_index < N {
            self.data[bit_index / 64] |= 1u64 << (bit_index % 64);
        }
    }
}

impl<const N: usize> Default for FastFixedBitSet<N> {
    fn default() -> Self {
        Self::new()
    }
}

pub const fn bits_to_longs(n: usize) -> usize {
    (n + 63) / 64
}
