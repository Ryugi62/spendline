// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface ITRC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @title SpendlineVault — pays only inside the line the user drew; every stop is an on-chain event.
/// @notice Check order and reason codes MUST match src/domain/mandate.ts (BLOCK_REASONS, 1-based).
contract SpendlineVault {
    uint8 public constant PAUSED = 1;
    uint8 public constant DEADLINE_PASSED = 2;
    uint8 public constant MERCHANT_NOT_ALLOWED = 3;
    uint8 public constant INVALID_AMOUNT = 4;
    uint8 public constant OVER_TX_CAP = 5;
    uint8 public constant OVER_BUDGET_WITH_FEES = 6;

    address public owner;
    address public agent;
    address public token;
    address public feeCollector;

    bytes32 public mandateId;
    uint256 public budget;
    uint256 public perTxCap;
    uint256 public deadline;
    uint256 public spent;
    bool public paused;
    mapping(address => bool) public allowed;
    address[] private merchantList;

    event MandateGranted(bytes32 indexed mandateId, uint256 budget, uint256 perTxCap, uint256 deadline, address[] merchants);
    event Paid(bytes32 indexed receiptHash, bytes32 indexed mandateId, address merchant, uint256 amount, uint256 fee, uint256 spentAfter);
    event SpendBlocked(bytes32 indexed receiptHash, bytes32 indexed mandateId, address merchant, uint256 amount, uint256 fee, uint8 reason);
    event Paused(address by);
    event Resumed(address by);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }
    modifier onlyAgent() {
        require(msg.sender == agent, "agent only");
        _;
    }

    constructor(address _token, address _agent, address _feeCollector) {
        owner = msg.sender;
        token = _token;
        agent = _agent;
        feeCollector = _feeCollector;
    }

    /// Human grants (or replaces) the mandate. Resets spent and unpauses.
    function grant(bytes32 _mandateId, uint256 _budget, uint256 _perTxCap, uint256 _deadline, address[] calldata _merchants) external onlyOwner {
        for (uint256 i = 0; i < merchantList.length; i++) allowed[merchantList[i]] = false;
        delete merchantList;
        for (uint256 i = 0; i < _merchants.length; i++) {
            allowed[_merchants[i]] = true;
            merchantList.push(_merchants[i]);
        }
        mandateId = _mandateId;
        budget = _budget;
        perTxCap = _perTxCap;
        deadline = _deadline;
        spent = 0;
        paused = false;
        emit MandateGranted(_mandateId, _budget, _perTxCap, _deadline, _merchants);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function resume() external onlyOwner {
        paused = false;
        emit Resumed(msg.sender);
    }

    /// Same order as evaluate() in the domain. 0 = allowed.
    function check(address merchant, uint256 amount, uint256 fee) public view returns (uint8) {
        if (paused) return PAUSED;
        if (block.timestamp > deadline) return DEADLINE_PASSED;
        if (!allowed[merchant]) return MERCHANT_NOT_ALLOWED;
        if (amount == 0) return INVALID_AMOUNT;
        if (amount + fee > perTxCap) return OVER_TX_CAP;
        if (spent + amount + fee > budget) return OVER_BUDGET_WITH_FEES;
        return 0;
    }

    /// Stops are events, not reverts: refusing is a correct outcome and belongs on the record.
    function pay(address merchant, uint256 amount, uint256 fee, bytes32 receiptHash) external onlyAgent returns (bool) {
        uint8 reason = check(merchant, amount, fee);
        if (reason != 0) {
            emit SpendBlocked(receiptHash, mandateId, merchant, amount, fee, reason);
            return false;
        }
        spent += amount + fee;
        _send(merchant, amount);
        if (fee > 0) _send(feeCollector, fee);
        emit Paid(receiptHash, mandateId, merchant, amount, fee, spent);
        return true;
    }

    function merchants() external view returns (address[] memory) {
        return merchantList;
    }

    function nowTs() external view returns (uint256) {
        return block.timestamp;
    }

    function withdraw(uint256 amount) external onlyOwner {
        _send(owner, amount);
    }

    /// TRON USDT's transfer() returns false even on success (measured on Nile 2026-09-24), so the return value is not trusted:
    /// success = the call did not revert AND the recipient balance grew by exactly `value`.
    function _send(address to, uint256 value) private {
        uint256 before = ITRC20(token).balanceOf(to);
        (bool ok, ) = token.call(abi.encodeWithSelector(ITRC20.transfer.selector, to, value));
        require(ok && ITRC20(token).balanceOf(to) == before + value, "transfer failed");
    }
}
