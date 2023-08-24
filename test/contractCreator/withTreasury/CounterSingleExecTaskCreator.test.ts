/* eslint-disable @typescript-eslint/no-explicit-any */
import { Signer } from "@ethersproject/abstract-signer";
import { expect } from "chai";
import hre = require("hardhat");

import { getAutomateAddress, getGelatoAddress, getTreasuryAddress } from "../../../hardhat/config/addresses";

const { ethers, deployments } = hre;
import { ITaskTreasuryUpgradable, IAutomate, CounterResolverTaskCreatorWT } from "../../../typechain";
import { getTaskId } from "../../utils";
import { impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";

const TASK_TREASURY_ADDRESS = getTreasuryAddress("hardhat");
const GELATO_ADDRESS = getGelatoAddress("hardhat");
const AUTOMATE_ADDRESS = getAutomateAddress("hardhat");
const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO_ADD = ethers.constants.AddressZero;
const FEE = ethers.utils.parseEther("0.1");

describe("ContactCreator Gelato Single Exec Tests", function () {
  this.timeout(0);

  let user: Signer;
  let executor: Signer;
  let taskTreasury: ITaskTreasuryUpgradable;
  let automate: IAutomate;
  let counter: CounterResolverTaskCreatorWT;

  before(async function () {
    await deployments.fixture();
    [, user] = await ethers.getSigners();

    automate = await ethers.getContractAt("contracts/interfaces/IAutomate.sol:IAutomate", AUTOMATE_ADDRESS);
    taskTreasury = await ethers.getContractAt(
      "contracts/interfaces/ITaskTreasuryUpgradable.sol:ITaskTreasuryUpgradable",
      TASK_TREASURY_ADDRESS
    );

    console.log(" ");
    console.log("\x1b[32m%s\x1b[0m", "    ->", `\x1b[30mImpersonating Executor ${GELATO_ADDRESS}`);
    await impersonateAccount(GELATO_ADDRESS);
    executor = ethers.provider.getSigner(GELATO_ADDRESS);

    console.log("\x1b[32m%s\x1b[0m", "    ->", `\x1b[30mCreating the task`);
    console.log(" ");

    counter = await ethers.getContract("CounterSingleExecTaskCreator", user);
    await counter.createTask();
  });

  it("It executes properly", async () => {
    let taskId = await counter.taskId();

    let moduleData = {
      modules: [2, 3],
      args: ["0x", "0x"],
    };

    let feeToken = ZERO_ADD;
    let selector = counter.interface.getSighash("increaseCount"); //counter.interface.getSighash("increaseCount");

    const calculatedTaskId = getTaskId(counter.address, counter.address, selector, moduleData, feeToken);

    expect(taskId).equal(calculatedTaskId);
    console.log("\x1b[32m%s\x1b[0m", "    ✔", `\x1b[30mTaksId correct`);

    const execData = await counter.interface.encodeFunctionData("increaseCount", [1]);

    // Execution Reverted without funding the treasury
    await expect(
      automate.connect(executor).exec(counter.address, counter.address, execData, moduleData, FEE, ETH, true, true, {
        gasLimit: 1_000_000,
      })
    ).to.be.revertedWith("TaskTreasury: Not enough funds");
    console.log("\x1b[32m%s\x1b[0m", "    ✔", `\x1b[30mExecution reverted as expected wo funding the treasury`);

    // DEPOSIT funds into the treasury
    const depositAmount = ethers.utils.parseEther("100");
    await taskTreasury.connect(user).depositFunds(counter.address, ETH, depositAmount, { value: depositAmount });

    //// EXECUTION
    await automate
      .connect(executor)
      .exec(counter.address, counter.address, execData, moduleData, FEE, ETH, true, true, {
        gasLimit: 1_000_000,
      });

    const counterNr = await counter.count();
    expect(+counterNr.toString()).to.equal(1);
    console.log("\x1b[32m%s\x1b[0m", "    ✔", `\x1b[30mExecution successful increment +1`);

    // Execution Reverted without funding the contract
    await expect(
      automate.connect(executor).exec(counter.address, counter.address, execData, moduleData, FEE, ETH, true, true, {
        gasLimit: 1_000_000,
      })
    ).to.be.revertedWith("Automate.exec: Task not found");
    console.log("\x1b[32m%s\x1b[0m", "    ✔", `\x1b[30mRevert succesfully after one execution`);
  });
});
